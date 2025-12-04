import type { UTCTimestamp } from "lightweight-charts";

export type DrawingToolId =
  | "cursor"
  | "trend-line"
  | "ray"
  | "rectangle"
  | "parallel-channel"
  | "triangle"
  | "brush"
  | "text"
  | "horizontal-line"
  | "vertical-line"
  | "price-label"
  | "callout"
  | "icon";

export type DrawingPaneTarget = "main" | "indicator";

export interface LogicalPoint {
  time: UTCTimestamp | number;
  price: number;
}

export interface ScreenAnchor {
  x: number;
  y: number;
}

export type AnchorMode = "logical" | "screen";

export type LineStyleType = "solid" | "dashed" | "dotted";

export interface StrokeStyle {
  color: string;
  width: number;
  style: LineStyleType;
}

export interface FillStyle {
  color: string;
  opacity: number;
}

export interface DrawingBase {
  id: string;
  type: DrawingToolId;
  pane: DrawingPaneTarget;
  hidden: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  meta?: Record<string, unknown>;
}

export interface MultiPointDrawing extends DrawingBase {
  points: LogicalPoint[];
  stroke: StrokeStyle;
  fill?: FillStyle;
}

export interface TrendLineDrawing extends MultiPointDrawing {
  type: "trend-line";
  extendLeft?: boolean;
  extendRight?: boolean;
}

export interface RayDrawing extends MultiPointDrawing {
  type: "ray";
  direction: "left" | "right";
}

export interface RectangleDrawing extends MultiPointDrawing {
  type: "rectangle";
}

export interface ParallelChannelDrawing extends MultiPointDrawing {
  type: "parallel-channel";
  // The third point determines the offset of the parallel line.
}

export interface TriangleDrawing extends MultiPointDrawing {
  type: "triangle";
}

export interface BrushDrawing extends MultiPointDrawing {
  type: "brush";
  smooth?: boolean;
}

export interface HorizontalLineDrawing extends DrawingBase {
  type: "horizontal-line";
  price: number;
  stroke: StrokeStyle;
  label?: string;
}

export interface VerticalLineDrawing extends DrawingBase {
  type: "vertical-line";
  time: UTCTimestamp | number;
  stroke: StrokeStyle;
  label?: string;
}

export interface TextDrawing extends DrawingBase {
  type: "text";
  point: LogicalPoint;
  text: string;
  textColor: string;
  background?: FillStyle;
  fontSize: number;
  fontFamily: string;
  padding: number;
  anchor?: { mode: AnchorMode; screen?: ScreenAnchor };
}

export interface PriceLabelDrawing extends DrawingBase {
  type: "price-label";
  point: LogicalPoint;
  text: string;
  background: FillStyle;
  textColor: string;
}

export interface CalloutDrawing extends DrawingBase {
  type: "callout";
  point: LogicalPoint;
  text: string;
  textColor: string;
  background: FillStyle;
  anchorMode: AnchorMode;
  screenAnchor?: ScreenAnchor;
}

export interface IconDrawing extends DrawingBase {
  type: "icon";
  point: LogicalPoint;
  icon: string;
  color: string;
  size: number;
}

export type DrawingShape =
  | TrendLineDrawing
  | RayDrawing
  | RectangleDrawing
  | ParallelChannelDrawing
  | TriangleDrawing
  | BrushDrawing
  | HorizontalLineDrawing
  | VerticalLineDrawing
  | TextDrawing
  | PriceLabelDrawing
  | CalloutDrawing
  | IconDrawing;

export interface DrawingTemplate {
  id: string;
  name: string;
  description?: string;
  drawings: DrawingShape[];
}

export type ToolKind = "single-point" | "multi-point" | "freehand";

export interface DrawingToolDefinition {
  id: DrawingToolId;
  label: string;
  icon: string;
  kind: ToolKind;
  minPoints: number;
  maxPoints: number;
  paneTarget: DrawingPaneTarget;
  supportsFill: boolean;
  hasText?: boolean;
}
