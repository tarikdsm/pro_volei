import type {
  BroadcastFrameSolution,
  CameraPoint,
  CameraFrame,
  SafeFrame,
  ScreenPoint,
  ScreenRect,
} from './CameraFrame';

const SAFE_MARGIN_PX = 12;
const DEPTH_TO_VERTICAL = 0.32;
const SUBJECT_PADDING_METERS = 1.2;
const MIN_WORLD_SPAN_METERS = 2.4;
const DEAD_ZONE_RATIO = 0.08;
const DESTINATION_MIN_PIXELS_PER_METER = 18;
const DESTINATION_MIN_SCALE_RATIO = 0.9;

interface FittedSubjects {
  center: MutablePoint2;
  pixelsPerMeter: number;
}

type MutablePoint2 = { x: number; y: number };
type MutablePoint3 = { x: number; y: number; z: number };
type MutableSolution = {
  focus: MutablePoint3;
  projectedCenter: MutablePoint2;
  pixelsPerMeter: number;
  safeRect: { x: number; y: number; width: number; height: number };
  subjects: { ball: MutablePoint2; controlled?: MutablePoint2; destination?: MutablePoint2 };
  destinationIncluded: boolean;
  deadZoneApplied: boolean;
};

function copy2(target: MutablePoint2 | undefined, source: ScreenPoint | undefined) {
  if (!source) return undefined;
  const out = target ?? { x: 0, y: 0 };
  out.x = source.x;
  out.y = source.y;
  return out;
}

const safeRectScratch = { x: 0, y: 0, width: 1, height: 1 };
const mandatoryFitScratch: FittedSubjects = { center: { x: 0, y: 0 }, pixelsPerMeter: 1 };
const candidateFitScratch: FittedSubjects = { center: { x: 0, y: 0 }, pixelsPerMeter: 1 };
const focusScratch = { x: 0, y: 0, z: 0 };
const ballScratch = { x: 0, y: 0 };
const controlledScratch = { x: 0, y: 0 };
const destinationScratch = { x: 0, y: 0 };

function writeSolution(
  output: BroadcastFrameSolution | undefined,
  focus: CameraPoint,
  projectedCenter: ScreenPoint,
  pixelsPerMeter: number,
  safeRect: ScreenRect,
  ball: ScreenPoint,
  controlled: ScreenPoint | undefined,
  destination: ScreenPoint | undefined,
  destinationIncluded: boolean,
  deadZoneApplied: boolean,
): BroadcastFrameSolution {
  const out: MutableSolution = output
    ? (output as MutableSolution)
    : {
        focus: { x: 0, y: 0, z: 0 },
        projectedCenter: { x: 0, y: 0 },
        pixelsPerMeter: 1,
        safeRect: { x: 0, y: 0, width: 1, height: 1 },
        subjects: { ball: { x: 0, y: 0 } },
        destinationIncluded: false,
        deadZoneApplied: false,
      };
  out.focus.x = focus.x;
  out.focus.y = focus.y;
  out.focus.z = focus.z;
  out.projectedCenter.x = projectedCenter.x;
  out.projectedCenter.y = projectedCenter.y;
  out.pixelsPerMeter = pixelsPerMeter;
  out.safeRect.x = safeRect.x;
  out.safeRect.y = safeRect.y;
  out.safeRect.width = safeRect.width;
  out.safeRect.height = safeRect.height;
  out.subjects.ball = copy2(out.subjects.ball, ball)!;
  out.subjects.controlled = copy2(out.subjects.controlled, controlled);
  out.subjects.destination = copy2(out.subjects.destination, destination);
  out.destinationIncluded = destinationIncluded;
  out.deadZoneApplied = deadZoneApplied;
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitSubjects(
  first: CameraPoint,
  second: CameraPoint | undefined,
  third: CameraPoint | undefined,
  safeRect: ScreenRect,
  out: FittedSubjects,
): FittedSubjects {
  let minHorizontal = first.x;
  let maxHorizontal = first.x;
  const firstVertical = first.y - first.z * DEPTH_TO_VERTICAL;
  let minVertical = firstVertical;
  let maxVertical = firstVertical;
  if (second) {
    const vertical = second.y - second.z * DEPTH_TO_VERTICAL;
    minHorizontal = Math.min(minHorizontal, second.x);
    maxHorizontal = Math.max(maxHorizontal, second.x);
    minVertical = Math.min(minVertical, vertical);
    maxVertical = Math.max(maxVertical, vertical);
  }
  if (third) {
    const vertical = third.y - third.z * DEPTH_TO_VERTICAL;
    minHorizontal = Math.min(minHorizontal, third.x);
    maxHorizontal = Math.max(maxHorizontal, third.x);
    minVertical = Math.min(minVertical, vertical);
    maxVertical = Math.max(maxVertical, vertical);
  }
  const horizontalSpan = Math.max(
    MIN_WORLD_SPAN_METERS,
    maxHorizontal - minHorizontal + SUBJECT_PADDING_METERS * 2,
  );
  const verticalSpan = Math.max(
    MIN_WORLD_SPAN_METERS,
    maxVertical - minVertical + SUBJECT_PADDING_METERS * 2,
  );
  out.center.x = (minHorizontal + maxHorizontal) * 0.5;
  out.center.y = (minVertical + maxVertical) * 0.5;
  out.pixelsPerMeter = Math.min(safeRect.width / horizontalSpan, safeRect.height / verticalSpan);
  return out;
}

/**
 * Extrai o maior retângulo central previsível. Overlays ancorados em uma borda recortam
 * somente aquela borda; controles nos dois cantos inferiores, por exemplo, reservam a faixa
 * inferior sem obrigar o solver a conhecer o layout que os produziu.
 */
function computeSafeRect(safeFrame: SafeFrame, out: MutableSolution['safeRect']): ScreenRect {
  const viewportWidth = Math.max(1, safeFrame.viewport.width);
  const viewportHeight = Math.max(1, safeFrame.viewport.height);
  let left = clamp(safeFrame.insets.left, 0, viewportWidth);
  let top = clamp(safeFrame.insets.top, 0, viewportHeight);
  let right = clamp(viewportWidth - safeFrame.insets.right, left, viewportWidth);
  let bottom = clamp(viewportHeight - safeFrame.insets.bottom, top, viewportHeight);

  for (const overlay of safeFrame.overlays) {
    const overlayRight = overlay.x + overlay.width;
    const overlayBottom = overlay.y + overlay.height;
    if (!(left < overlayRight && right > overlay.x && top < overlayBottom && bottom > overlay.y))
      continue;
    const centerX = (left + right) * 0.5;
    const centerY = (top + bottom) * 0.5;

    if (overlayBottom >= bottom && overlay.y > top) {
      bottom = Math.min(bottom, overlay.y);
    } else if (overlay.y <= top && overlayBottom < bottom) {
      top = Math.max(top, overlayBottom);
    } else if (overlay.x <= left && overlayRight < right) {
      left = Math.max(left, overlayRight);
    } else if (overlayRight >= right && overlay.x > left) {
      right = Math.min(right, overlay.x);
    } else if (overlayRight <= centerX) {
      left = Math.max(left, overlayRight);
    } else if (overlay.x >= centerX) {
      right = Math.min(right, overlay.x);
    } else if (overlayBottom <= centerY) {
      top = Math.max(top, overlayBottom);
    } else if (overlay.y >= centerY) {
      bottom = Math.min(bottom, overlay.y);
    }
  }

  left += SAFE_MARGIN_PX;
  top += SAFE_MARGIN_PX;
  right -= SAFE_MARGIN_PX;
  bottom -= SAFE_MARGIN_PX;

  if (right <= left) {
    const center = (left + right) * 0.5;
    left = center - 0.5;
    right = center + 0.5;
  }
  if (bottom <= top) {
    const center = (top + bottom) * 0.5;
    top = center - 0.5;
    bottom = center + 0.5;
  }

  out.x = left;
  out.y = top;
  out.width = right - left;
  out.height = bottom - top;
  return out;
}

function isInsideBounds(point: CameraPoint, frame: CameraFrame): boolean {
  return (
    point.x >= frame.bounds.min.x &&
    point.x <= frame.bounds.max.x &&
    point.y >= frame.bounds.min.y &&
    point.y <= frame.bounds.max.y &&
    point.z >= frame.bounds.min.z &&
    point.z <= frame.bounds.max.z
  );
}

function screenPoint(
  point: CameraPoint,
  projectedCenter: ScreenPoint,
  pixelsPerMeter: number,
  safeRect: ScreenRect,
  out: MutablePoint2,
): ScreenPoint {
  out.x = safeRect.x + safeRect.width * 0.5 + (point.x - projectedCenter.x) * pixelsPerMeter;
  out.y =
    safeRect.y +
    safeRect.height * 0.5 -
    (point.y - point.z * DEPTH_TO_VERTICAL - projectedCenter.y) * pixelsPerMeter;
  return out;
}

function pointInside(point: ScreenPoint, rect: ScreenRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function sameRect(a: ScreenRect, b: ScreenRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function physicalFocus(frame: CameraFrame, includeDestination: boolean): CameraPoint {
  let x = frame.ball.x;
  let y = frame.ball.y;
  let z = frame.ball.z;
  let count = 1;
  if (frame.controlled) {
    x += frame.controlled.x;
    y += frame.controlled.y;
    z += frame.controlled.z;
    count += 1;
  }
  if (includeDestination && frame.destination) {
    x += frame.destination.x;
    y += frame.destination.y;
    z += frame.destination.z;
    count += 1;
  }
  focusScratch.x = clamp(x / count, frame.bounds.min.x, frame.bounds.max.x);
  focusScratch.y = clamp(y / count, frame.bounds.min.y, frame.bounds.max.y);
  focusScratch.z = clamp(z / count, frame.bounds.min.z, frame.bounds.max.z);
  return focusScratch;
}

export function solveBroadcastFrame(
  frame: CameraFrame,
  safeFrame: SafeFrame,
  previous?: BroadcastFrameSolution,
  output?: BroadcastFrameSolution,
): BroadcastFrameSolution {
  const safeRect = computeSafeRect(safeFrame, safeRectScratch);
  const mandatoryFit = fitSubjects(
    frame.ball,
    frame.controlled,
    undefined,
    safeRect,
    mandatoryFitScratch,
  );
  const candidateFit = frame.destination
    ? fitSubjects(frame.ball, frame.controlled, frame.destination, safeRect, candidateFitScratch)
    : undefined;
  const destinationIncluded = Boolean(
    frame.destination &&
    candidateFit &&
    isInsideBounds(frame.destination, frame) &&
    candidateFit.pixelsPerMeter >=
      Math.min(
        DESTINATION_MIN_PIXELS_PER_METER,
        mandatoryFit.pixelsPerMeter * DESTINATION_MIN_SCALE_RATIO,
      ),
  );
  const fitted = destinationIncluded && candidateFit ? candidateFit : mandatoryFit;

  if (previous && sameRect(previous.safeRect, safeRect)) {
    const ball = screenPoint(
      frame.ball,
      previous.projectedCenter,
      previous.pixelsPerMeter,
      safeRect,
      ballScratch,
    );
    const controlled = frame.controlled
      ? screenPoint(
          frame.controlled,
          previous.projectedCenter,
          previous.pixelsPerMeter,
          safeRect,
          controlledScratch,
        )
      : undefined;
    const destination =
      destinationIncluded && frame.destination
        ? screenPoint(
            frame.destination,
            previous.projectedCenter,
            previous.pixelsPerMeter,
            safeRect,
            destinationScratch,
          )
        : undefined;
    const ballMovementX = Math.abs(ball.x - previous.subjects.ball.x);
    const ballMovementY = Math.abs(ball.y - previous.subjects.ball.y);
    const mandatoryInside =
      pointInside(ball, safeRect) && (!controlled || pointInside(controlled, safeRect));
    const destinationFits = !destination || pointInside(destination, safeRect);
    const insideDeadZone =
      ballMovementX <= safeRect.width * DEAD_ZONE_RATIO &&
      ballMovementY <= safeRect.height * DEAD_ZONE_RATIO;

    if (mandatoryInside && destinationFits && insideDeadZone) {
      return writeSolution(
        output,
        previous.focus,
        previous.projectedCenter,
        previous.pixelsPerMeter,
        safeRect,
        ball,
        controlled,
        destination,
        destinationIncluded,
        true,
      );
    }
  }

  const ball = screenPoint(frame.ball, fitted.center, fitted.pixelsPerMeter, safeRect, ballScratch);
  const controlled = frame.controlled
    ? screenPoint(
        frame.controlled,
        fitted.center,
        fitted.pixelsPerMeter,
        safeRect,
        controlledScratch,
      )
    : undefined;
  const destination =
    destinationIncluded && frame.destination
      ? screenPoint(
          frame.destination,
          fitted.center,
          fitted.pixelsPerMeter,
          safeRect,
          destinationScratch,
        )
      : undefined;
  return writeSolution(
    output,
    physicalFocus(frame, destinationIncluded),
    fitted.center,
    fitted.pixelsPerMeter,
    safeRect,
    ball,
    controlled,
    destination,
    destinationIncluded,
    false,
  );
}
