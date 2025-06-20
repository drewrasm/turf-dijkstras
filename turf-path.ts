import distance from '@turf/distance';
import {
  Coord,
  Feature,
  LineString,
  lineString,
  MultiLineString,
  point,
  Point,
  Units,
} from '@turf/helpers';
import turfLengthHelper from '@turf/length';
import lineIntersect from '@turf/line-intersect';
import lineSlice from '@turf/line-slice';
import { flattenEach } from '@turf/meta';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import pointToLineDistance from '@turf/point-to-line-distance';

// Define a more specific type for distance units
type DistanceUnits = 'degrees' | 'radians' | 'miles' | 'kilometers' | 'meters' | 'feet' | 'inches' | 'centimeters' | 'millimeters' | 'nauticalmiles' | 'yards';

// Force all distances to be in miles
export const turfDistance = (
  from: Coord | Point,
  to: Coord | Point,
  units: DistanceUnits = 'miles',
) => {
  return distance(from, to, { units });
};

export const turfLength = (
  line: Feature<LineString | MultiLineString>,
  options: { units: Units } = { units: 'miles' },
) => {
  return turfLengthHelper(line, options);
};

const pathErrors = {
  NoPath: 'No path was found within the given start and end points',
  TooFarFromRivers: 'The start or end point is too far from a river',
  TimedOut: 'The pathfinding operation timed out',
  Unknown: 'Oops, something went wrong',
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
  linestrings: Feature<LineString>[] = []; // Store the linestrings used for the network

  startTime: number | null = null;
  maximumTimeLimit = 30 * 1000;

  constructor(
    allFeatures: Feature<MultiLineString | LineString>[],
    start: number[],
    end: number[],
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

    const processLineString = (
      linestring: Feature<LineString>,
    ) => {
      if (linestring.geometry.type === 'LineString') {
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

    allFeatures.forEach((linestring) => {
      if (this.isTimedOut()) return; // break out early if we've timed out
      if (linestring.geometry.type === 'LineString') {
        processLineString(linestring as Feature<LineString>);
      } else if (linestring.geometry.type === 'MultiLineString') {
        flattenEach(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          linestring as any,
          (currentFeature: Feature<LineString>) => {
            processLineString(currentFeature);
          },
        );
      }
    });

    if (
      startPointInfo.closestLineDistance > this.allowedDistanceFromRivers ||
      endPointInfo.closestLineDistance > this.allowedDistanceFromRivers
    ) {
      console.log(
        'start or end point too far from rivers, defaulting to straight line path',
      );
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
    this.linestrings = linestrings; // Store the linestrings for later use
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
            const lineStringI = newLinestrings.get(`${i}`);
            const lineStringJ = newLinestrings.get(`${j}`);
            
            if (lineStringI) {
              const newLineString = this.insertPointIntoLineString(
                lineStringI,
                intersection,
              );
              if (newLineString.success && newLineString.updatedLine) {
                newLinestrings.set(`${i}`, newLineString.updatedLine);
              }
            }
            
            if (lineStringJ) {
              const newLineString2 = this.insertPointIntoLineString(
                lineStringJ,
                intersection,
              );
              if (newLineString2.success && newLineString2.updatedLine) {
                newLinestrings.set(`${j}`, newLineString2.updatedLine);
              }
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
      if (areCoordsEqual(lineCoords[i], lineCoords[i + 1])) {
        continue;
      }
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

    // Priority queue for nodes to visit (using a simple array but more efficiently)
    const pq: [string, number][] = [];
    
    // Initialize distances to infinity and predecessors to null
    for (const node of graph.keys()) {
      distances.set(node, Infinity);
      predecessors.set(node, null);
    }
    
    // Set source distance to 0 and add to priority queue
    distances.set(source, 0);
    pq.push([source, 0]);

    while (pq.length > 0) {
      // Find the node with minimum distance (more efficient than sorting every time)
      let minIndex = 0;
      for (let i = 1; i < pq.length; i++) {
        if (pq[i][1] < pq[minIndex][1]) {
          minIndex = i;
        }
      }
      
      // Swap with first element and remove
      [pq[0], pq[minIndex]] = [pq[minIndex], pq[0]];
      const dequeued = pq.shift();
      if (!dequeued) break;
      const [currentNode, currentDistance] = dequeued;

      if (visited.has(currentNode)) continue;
      visited.add(currentNode);

      // If we reached the target, we're done
      if (currentNode === target) break;

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
    try {
      if (this.isTimedOut()) {
        return {
          path: lineString([start, end]),
          distance: turfDistance(point(start), point(end)),
          success: false,
          error: pathErrors.TimedOut,
        };
      }

      if (this.isTooFarFromRivers) {
        return {
          path: lineString([start, end]),
          distance: turfDistance(point(start), point(end)),
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
      console.log('rip no path, path logic is bad or somethin')
      if (distance === Infinity) {
        return {
          path: lineString([start, end]),
          distance: turfDistance(point(start), point(end)),
          success: false,
          error: pathErrors.NoPath,
        };
      }

      const formattedPath = path.map((coord) => {
        const [x, y] = coord.split(',').map(Number);
        return [x, y];
      });

      const lineStringPath = lineString(formattedPath);

      const trueDistance = calculateDistanceAlongRiver(
        point(start).geometry,
        point(end).geometry,
        lineStringPath.geometry,
      );
      console.log('oh well we get here then I guess hmmm')
      return {
        path: lineString(formattedPath),
        distance: Number(trueDistance.distance),
        success: true,
      };
    } catch (error) {
      console.log('WE HIT THIS ERROR', error);
      return {
        path: lineString([start, end]),
        distance: turfDistance(point(start), point(end)),
        success: false,
        error: pathErrors.Unknown,
      };
    }
  };
}

const areCoordsEqual = (coord1: number[], coord2: number[]): boolean => {
  return coord1[0] === coord2[0] && coord1[1] === coord2[1];
};

// same river logic
export const isPointNearRiver = (
  coords: number[],
  river: Feature<LineString | MultiLineString>,
): boolean => {
  const pointOnLine = nearestPointOnLine(river, point(coords));
  const distance = turfDistance(pointOnLine, point(coords), 'meters');
  console.log('distance for end point to river', distance);
  const isCloseEnough = distance < 100;
  return isCloseEnough;
};

export const formatDistance = (distance: number): number => {
  return distance % 1 === 0 ? distance : parseFloat(distance.toFixed(2));
};

export const commonRiverPath = (
  start: number[],
  end: number[],
  river: Feature<LineString>,
): {
  path: Feature<LineString>;
  distance: number;
} => {
  const slice = lineSlice(start, end, river);
  const nearestPointForStart = nearestPointOnLine(slice, point(start));
  const nearestPointForEnd = nearestPointOnLine(slice, point(end));

  const endIsFurtherFromStartOfSlice =
    turfDistance(nearestPointForEnd, slice.geometry.coordinates[0]) >
    turfDistance(nearestPointForStart, slice.geometry.coordinates[0]);

  if (endIsFurtherFromStartOfSlice) {
    const path = lineString([
      start,
      nearestPointForStart.geometry.coordinates,
      ...slice.geometry.coordinates.slice(1, -1),
      nearestPointForEnd.geometry.coordinates,
      end,
    ]);
    const pathDistance = turfLength(path);
    return {
      path,
      distance: formatDistance(pathDistance),
    };
  } else {
    const path = lineString([
      end,
      nearestPointForEnd.geometry.coordinates,
      ...slice.geometry.coordinates.slice(1, -1),
      nearestPointForStart.geometry.coordinates,
      start,
    ]);
    const pathDistance = turfLength(path);
    return {
      path,
      distance: formatDistance(pathDistance),
    };
  }
};

export function calculateDistanceAlongRiver(
  start: GeoJSON.Point,
  stop: GeoJSON.Point,
  river: GeoJSON.LineString,
): { distance: string; line: Feature<LineString> } {
  const turfOptions: { units: DistanceUnits } = { units: 'miles' };
  const startPoint = nearestPointOnLine(river, start, turfOptions);
  const stopPoint = nearestPointOnLine(river, stop, turfOptions);
  const sliced = lineSlice(startPoint, stopPoint, river);

  let closestToStartOfSlice = start;
  let closestToEndOfSlice = stop;
  const length = sliced.geometry.coordinates.length;

  if (
    distance(sliced.geometry.coordinates[0], start.coordinates, turfOptions) >
    distance(
      sliced.geometry.coordinates[length - 1],
      start.coordinates,
      turfOptions,
    )
  ) {
    closestToStartOfSlice = stop;
    closestToEndOfSlice = start;
  }

  return {
    distance: `${(
      turfLength(sliced, turfOptions) +
      (startPoint.properties.dist ?? 0) +
      (stopPoint.properties.dist ?? 0)
    ).toFixed(2)}`,
    line: {
      type: 'Feature',
      properties: {},
      geometry: {
        coordinates: [
          closestToStartOfSlice.coordinates,
          ...sliced.geometry.coordinates,
          closestToEndOfSlice.coordinates,
        ],
        type: 'LineString',
      },
    },
  };
}


