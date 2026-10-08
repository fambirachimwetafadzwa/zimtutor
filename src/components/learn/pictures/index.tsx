import type { StemData } from "@/lib/questions/types";
import {
  BarChartPicture,
  LineGraphPicture,
  PictographPicture,
  PieChartPicture,
  TablePicture,
  TallyPicture,
} from "./charts";
import {
  AnglePicture,
  AngleSumPicture,
  ClockPicture,
  CompassPicture,
  DialScalePicture,
  JugPicture,
  LinePicture,
  MapPicture,
  NumberLinePicture,
  RulerPicture,
} from "./measures";
import {
  CirclePartPicture,
  CuboidPicture,
  FractionBarPicture,
  GridPicture,
  LShapePicture,
  PolygonPicture,
  RectanglePicture,
  TrianglePicture,
} from "./shapes";

/**
 * Draws the picture that belongs to a question. Pure and script-free, so it can be rendered on the
 * server. Exhaustive over every picture kind: adding a kind to the question schema without drawing it
 * is a type error.
 */
export function Picture({ data }: { data: StemData }) {
  switch (data.kind) {
    case "table":
      return <TablePicture data={data} />;
    case "bar-chart":
      return <BarChartPicture data={data} />;
    case "pictograph":
      return <PictographPicture data={data} />;
    case "tally":
      return <TallyPicture data={data} />;
    case "fraction-bar":
      return <FractionBarPicture data={data} />;
    case "clock":
      return <ClockPicture data={data} />;
    case "rectangle":
      return <RectanglePicture data={data} />;
    case "l-shape":
      return <LShapePicture data={data} />;
    case "triangle":
      return <TrianglePicture data={data} />;
    case "cuboid":
      return <CuboidPicture data={data} />;
    case "angle":
      return <AnglePicture data={data} />;
    case "grid":
      return <GridPicture data={data} />;
    case "number-line":
      return <NumberLinePicture data={data} />;
    case "pie-chart":
      return <PieChartPicture data={data} />;
    case "line-graph":
      return <LineGraphPicture data={data} />;
    case "polygon":
      return <PolygonPicture data={data} />;
    case "circle-part":
      return <CirclePartPicture data={data} />;
    case "ruler":
      return <RulerPicture data={data} />;
    case "jug":
      return <JugPicture data={data} />;
    case "dial-scale":
      return <DialScalePicture data={data} />;
    case "compass":
      return <CompassPicture data={data} />;
    case "map":
      return <MapPicture data={data} />;
    case "line":
      return <LinePicture data={data} />;
    case "angle-sum":
      return <AngleSumPicture data={data} />;
  }
}
