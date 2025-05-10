import booleanIntersects from '@turf/boolean-intersects';
import turfDistance from '@turf/distance';
import {
  Feature,
  LineString,
  lineString,
  MultiLineString,
  point,
  Point,
  Polygon,
  FeatureCollection
} from '@turf/helpers';
import lineIntersect from '@turf/line-intersect';
import { flattenEach } from '@turf/meta';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import pointToLineDistance from '@turf/point-to-line-distance';

import {start, end, features} from './example-path-big.json';


const pathErrors = {
  NoPath: 'No path was found within the given start and end points',
  TooFarFromRivers: 'The start or end point is too far from a river',
  TimedOut: 'The pathfinding operation timed out',
};

type PathResult =
  | {
      path: Feature<LineString>;
      distance: number;
      success: true;
    }
  | {
      path: Feature<LineString>;
      distance: number;
      error: (typeof pathErrors)[keyof typeof pathErrors];
      success: false;
    };

/*
 * Takes multiline strings and convert into linestrings
 * Converts linestrings into a network of connected points
 * Handles intersections by splitting linestrings
 * Find shortest path between two points using Dijkstra's algorithm
 */

type Node = string;
type Edge = { target: Node; weight: number };
type Graph = Map<Node, Edge[]>;

type InitialPointInfo = {
  lineIndex: number;
  pointOnClosestLine: Feature<Point> | null;
  closestLineDistance: number;
};

export default class LinestringPathFinder {
  network: Graph;
  isTooFarFromRivers = false;
  allowedDistanceFromRivers = 40;

  startTime: number | null = null;
  maximumTimeLimit = 30 * 1000;

  constructor(
    allFeatures: Feature<MultiLineString | LineString>[],
    start: number[],
    end: number[],
    bufferPolygon: Feature<Polygon> | null,
    startLine?: Feature<MultiLineString | LineString>,
  ) {
    const startPointInfo: InitialPointInfo = {
      lineIndex: -1,
      pointOnClosestLine: null,
      closestLineDistance: Infinity,
    };

    const endPointInfo: InitialPointInfo = {
      lineIndex: -1,
      pointOnClosestLine: null,
      closestLineDistance: Infinity,
    };

    this.startTime = Date.now();

    const linestrings: Feature<LineString>[] = [];
    if (startLine) {
      allFeatures.push(startLine);
    }
    const shouldFilterOut = (linestring: Feature<LineString>) => {
      // isn't a tributary of the start line
      if (startLine && lineIntersect(linestring, startLine).features.length === 0) {
        return true;
      }
      // isn't in the buffer
      if (bufferPolygon && !booleanIntersects(linestring, bufferPolygon)) {
        return true;
      }
      return false;
    }

    const processLineString = (linestring: Feature<LineString>) => {
      if (linestring.geometry.type === 'LineString') {
        if (shouldFilterOut(linestring)) {
            return;
        }
        // find the closest linestring to the start and end points
        const pointOnLineForStart = nearestPointOnLine(
          linestring,
          point(start),
        );
        const distanceForStart = turfDistance(
          pointOnLineForStart,
          point(start),
        );
        if (distanceForStart < startPointInfo.closestLineDistance) {
          startPointInfo.lineIndex = linestrings.length;
          startPointInfo.pointOnClosestLine = pointOnLineForStart;
          startPointInfo.closestLineDistance = distanceForStart;
        }
        const pointOnLineForEnd = nearestPointOnLine(linestring, point(end));
        const distanceForEnd = turfDistance(pointOnLineForEnd, point(end));
        if (distanceForEnd < endPointInfo.closestLineDistance) {
          endPointInfo.lineIndex = linestrings.length;
          endPointInfo.pointOnClosestLine = pointOnLineForEnd;
          endPointInfo.closestLineDistance = distanceForEnd;
        }

        linestrings.push(linestring as Feature<LineString>);
      }
    };

    for (const linestring of allFeatures) {
      if (this.isTimedOut()) break; // break out early if we've timed out
      if (linestring.geometry.type === 'LineString') {
        processLineString(linestring as Feature<LineString>);
      } else if (linestring.geometry.type === 'MultiLineString') {
        flattenEach(
          linestring as any,
          (currentFeature: Feature<LineString>) => {
            processLineString(currentFeature);
          },
        );
      }
    }

    if (
      startPointInfo.closestLineDistance > this.allowedDistanceFromRivers ||
      endPointInfo.closestLineDistance > this.allowedDistanceFromRivers
    ) {
      this.isTooFarFromRivers = true;
      this.network = new Map();
      return;
    }

    // edit the linestrings that coorespond with the startLineIndex and endLineIndex
    if (startPointInfo.lineIndex !== -1 && startPointInfo.pointOnClosestLine) {
      const result = this.insertPointIntoLineString(
        linestrings[startPointInfo.lineIndex],
        startPointInfo.pointOnClosestLine.geometry.coordinates,
      );
      if (result.updatedLine) {
        linestrings[startPointInfo.lineIndex].geometry.coordinates =
          result.updatedLine.geometry.coordinates;
      }
    }
    if (endPointInfo.lineIndex !== -1 && endPointInfo.pointOnClosestLine) {
      const result = this.insertPointIntoLineString(
        linestrings[endPointInfo.lineIndex],
        endPointInfo.pointOnClosestLine.geometry.coordinates,
      );
      if (result.updatedLine) {
        linestrings[endPointInfo.lineIndex].geometry.coordinates =
          result.updatedLine.geometry.coordinates;
      }
    }
    if (startPointInfo.pointOnClosestLine && endPointInfo.pointOnClosestLine) {
      linestrings.push(
        lineString([
          startPointInfo.pointOnClosestLine.geometry.coordinates,
          start,
        ]),
      );
      linestrings.push(
        lineString([endPointInfo.pointOnClosestLine.geometry.coordinates, end]),
      );
    }

    this.network = this.buildNetwork(linestrings);
  }

  isTimedOut = () => {
    if (this.startTime === null) {
      return false;
    }
    const currentTime = Date.now();
    const timedOut = currentTime - this.startTime > this.maximumTimeLimit;
    if (timedOut)
      console.log('path finder timed out - defaulting to straight line path');
    return timedOut;
  };

  /**
   * Converts a coordinate to a string key (e.g., [x, y] -> "x,y")
   */
  coordToKey(coord: number[]): string {
    return `${coord[0]},${coord[1]}`;
  }

  getIntersections(linestrings: Feature<LineString>[]): Feature<LineString>[] {
    // change this so that per intersection we have the corrections
    const newLinestrings: Map<string, Feature<LineString>> = new Map();

    // Iterate through each pair of linestrings
    for (let i = 0; i < linestrings.length; i++) {
      if (i % 5 === 0 && this.isTimedOut()) return []; // every 5 linestrings, check if we've timed out
      for (let j = i + 1; j < linestrings.length; j++) {
        if (i % 5 === 0 && this.isTimedOut()) return []; // every 5 linestrings, check if we've timed out
        if (i !== j) {
          if (!newLinestrings.has(`${i}`)) {
            newLinestrings.set(`${i}`, linestrings[i]);
          }
          if (!newLinestrings.has(`${j}`)) {
            newLinestrings.set(`${j}`, linestrings[j]);
          }
          // Get intersection points
          const intersectPoints = lineIntersect(linestrings[i], linestrings[j]);

          intersectPoints.features.forEach((p) => {
            const intersection = p.geometry.coordinates;
            const newLineString = this.insertPointIntoLineString(
              newLinestrings.get(`${i}`)!,
              intersection,
            );
            if (newLineString.success) {
              newLinestrings.set(`${i}`, newLineString.updatedLine!);
            }
            const newLineString2 = this.insertPointIntoLineString(
              newLinestrings.get(`${j}`)!,
              intersection,
            );
            if (newLineString2.success) {
              newLinestrings.set(`${j}`, newLineString2.updatedLine!);
            }
          });
        }
      }
    }

    return [...newLinestrings.values()];
  }

  insertPointIntoLineString(
    line: Feature<LineString>,
    newPoint: number[],
  ): { updatedLine: Feature<LineString> | null; success: boolean } {
    const lineCoords = line.geometry.coordinates;
    let closestSegmentIndex = -1;
    let closestDistance = Infinity;

    // Find the segment where the new point should be inserted
    for (let i = 0; i < lineCoords.length - 1; i++) {
      const segment = lineString([lineCoords[i], lineCoords[i + 1]]);
      const distance = pointToLineDistance(point(newPoint), segment);

      if (distance < closestDistance) {
        closestDistance = distance;
        closestSegmentIndex = i;
      }
    }

    if (closestSegmentIndex === -1) {
      return { updatedLine: null, success: false };
    }

    // Insert the new point into the correct segment
    const updatedCoords = [
      ...lineCoords.slice(0, closestSegmentIndex + 1),
      newPoint,
      ...lineCoords.slice(closestSegmentIndex + 1),
    ];

    // Return the updated LineString
    return { updatedLine: lineString(updatedCoords), success: true };
  }

  /**
   * Builds a graph from an array of LineString features
   * @param linestrings - Array of GeoJSON LineString features
   * @returns An adjacency list representing the graph
   */
  buildNetwork(linestrings: Feature<LineString>[]): Graph {
    // initialize graph
    const graph: Graph = new Map();

    if (this.isTooFarFromRivers) {
      return graph;
    }

    // account for all intersections
    const formattedLineStrings = this.getIntersections(linestrings);

    // add weights and neighbors
    for (let i = 0; i < formattedLineStrings.length; i++) {
      // break out early if we've timed out every 5 linestrings
      if (i % 5 === 0 && this.isTimedOut()) {
        return new Map();
      }
      const linestring = formattedLineStrings[i];
      // since we've accounted for intersections in our formatted linestrings, each neighbor in this loop is guaranteed to be connected
      const coords = linestring.geometry.coordinates;
      // go through each coord and add it to the graph with its previous and next as neighbors w/weights
      for (let j = 0; j < coords.length; j++) {
        const coord = coords[j];
        const key = this.coordToKey(coord);
        const prevCoord: number[] | null = j === 0 ? null : coords[j - 1];
        const nextCoord: number[] | null =
          j === coords.length - 1 ? null : coords[j + 1];

        if (prevCoord) {
          const prevKey = this.coordToKey(prevCoord);
          const prevCoordDistance = turfDistance(coord, prevCoord);
          if (!graph.has(key)) {
            graph.set(key, []);
          }
          graph.get(key)?.push({ target: prevKey, weight: prevCoordDistance });
        }
        if (nextCoord) {
          const nextKey = this.coordToKey(nextCoord);
          const nextCoordDistance = turfDistance(coord, nextCoord);
          if (!graph.has(key)) {
            graph.set(key, []);
          }
          graph.get(key)?.push({ target: nextKey, weight: nextCoordDistance });
        }
      }
    }
    return graph;
  }

  dijkstra(
    graph: Graph,
    source: string,
    target: string,
  ): { path: string[]; distance: number } {
    // skip this process if the source is too far from rivers
    if (this.isTooFarFromRivers) {
      return {
        path: [],
        distance: Infinity,
      };
    }

    // Initialize distances and predecessors
    const distances: Map<string, number> = new Map();
    const predecessors: Map<string, string | null> = new Map();
    const visited: Set<string> = new Set();

    // Priority queue for nodes to visit
    const pq: [string, number][] = [];
    pq.push([source, 0]);
    distances.set(source, 0);

    // Initialize distances to infinity and predecessors to null
    for (const node of graph.keys()) {
      if (node !== source) distances.set(node, Infinity);
      predecessors.set(node, null);
    }

    while (pq.length > 0) {
      // Sort queue by distance and get the node with the smallest distance
      pq.sort((a, b) => a[1] - b[1]);
      const [currentNode, currentDistance] = pq.shift()!;

      if (visited.has(currentNode)) continue;
      visited.add(currentNode);

      // If we reached the target, no need to continue
      if (currentNode === target) break;

      // Relax neighbors
      const neighbors = graph.get(currentNode) || [];
      for (const { target: neighbor, weight } of neighbors) {
        if (visited.has(neighbor)) continue;

        const newDistance = currentDistance + weight;
        if (newDistance < (distances.get(neighbor) || Infinity)) {
          distances.set(neighbor, newDistance);
          predecessors.set(neighbor, currentNode);
          pq.push([neighbor, newDistance]);
        }
      }
    }

    // Reconstruct the shortest path
    const path: string[] = [];
    let step: string | null = target;

    while (step) {
      path.unshift(step);
      step = predecessors.get(step) || null;
    }

    // If the source is not part of the path, the target is unreachable
    if (path[0] !== source) return { path: [], distance: Infinity };

    return { path, distance: distances.get(target) || Infinity };
  }

  findShortestPath = (start: number[], end: number[]): PathResult => {
    if (this.isTimedOut()) {
      return {
        path: lineString([start, end]),
        distance: turfDistance(point(start), point(end), { units: 'miles' }),
        success: false,
        error: pathErrors.TimedOut,
      };
    }

    if (this.isTooFarFromRivers) {
      return {
        path: lineString([start, end]),
        distance: turfDistance(point(start), point(end), { units: 'miles' }),
        success: false,
        error: pathErrors.TooFarFromRivers,
      };
    }

    const { distance, path } = this.dijkstra(
      this.network,
      this.coordToKey(start),
      this.coordToKey(end),
    );

    // if a route isn't found, connect the start and end points
    if (distance === Infinity) {
      return {
        path: lineString([start, end]),
        distance: turfDistance(point(start), point(end), { units: 'miles' }),
        success: false,
        error: pathErrors.NoPath,
      };
    }

    const formattedPath = path.map((coord) => {
      const [x, y] = coord.split(',').map(Number);
      return [x, y];
    });

    return {
      path: lineString(formattedPath),
      distance: Number(distance),
      success: true,
    };
  };
}


const test = (highlight = false) => {


  const pathFinder = new LinestringPathFinder(features as Feature<MultiLineString | LineString>[], start, end, null);

  const res = pathFinder.findShortestPath(start, end);

  if(res.success === false) {
    console.log('ERROR', res.error)
  }

  const { path, distance } = res;

  if(highlight) {
    return [path, distance, highlightPathAndPoints(features as Feature<LineString>[], path, start, end)];
  }

  return [path, distance];

}

const highlightPathAndPoints = (
  linestrings: Feature<LineString>[],
  path: Feature<LineString>,
  start: number[],
  end: number[]
): FeatureCollection => {
  return {
    type: "FeatureCollection",
    features: [
      ...linestrings.map(line => ({
        ...line,
        properties: { ...line.properties, stroke: "#000000" },
      })),
      {
        ...path,
        properties: { stroke: "#71fd08" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: start },
        properties: { color: "#FFA500" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: end },
        properties: { color: "#FFA500" },
      },
    ],
  };
};

const startTime = Date.now();
const [path, distance, highlights] = test(true);

console.log(JSON.stringify(highlights))

console.log(`Time taken: ${Date.now() - startTime}ms`);
