import { Feature, LineString, lineString, MultiLineString, point } from '@turf/helpers';
import turfDistance from '@turf/distance';
import { flattenEach } from "@turf/meta";
import lineIntersect from "@turf/line-intersect";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import pointToLineDistance from '@turf/point-to-line-distance';

/*
  * Takes multiline strings and convert into linestrings
  * Converts linestrings into a network of connected points
  * Handles intersections by splitting linestrings
  * Find shortest path between two points
 */


type Node = string;
type Edge = { target: Node; weight: number };
type Graph = Map<Node, Edge[]>;

export default class LinestringPathFinder {
  network: Graph;
  isTooFarFromRivers: boolean = false;
  constructor(multiLinestrings: Feature<MultiLineString | LineString>[], start: number[], end: number[]) {
    let closestStartDistance = Infinity;
    let closestEndDistance = Infinity;
    let startLineIndex = -1;
    let endLineIndex = -1;
    let pointOnStartLine = null;
    let pointOnEndLine = null;

    let linestrings: Feature<LineString>[] = [];
    const multilineStrings: Feature<MultiLineString>[] = [];
    multiLinestrings.forEach((linestring) => {
      if (linestring.geometry.type === 'LineString') {
        // find the closest linestring to the start and end points
        const pointOnLineForStart = nearestPointOnLine(linestring, point(start));
        const distanceForStart = turfDistance(pointOnLineForStart, point(start));
        if (distanceForStart < closestStartDistance) {
          pointOnStartLine = pointOnLineForStart.geometry.coordinates;
          closestStartDistance = distanceForStart;
          startLineIndex = linestrings.length;
        }
        const pointOnLineForEnd = nearestPointOnLine(linestring, point(end));
        const distanceForEnd = turfDistance(pointOnLineForEnd, point(end));
        if (distanceForEnd < closestEndDistance) {
          pointOnEndLine = pointOnLineForEnd.geometry.coordinates;
          closestEndDistance = distanceForEnd;
          endLineIndex = linestrings.length;
        }


        linestrings.push(linestring as Feature<LineString>);
      } else if (linestring.geometry.type === 'MultiLineString') {
        multilineStrings.push(linestring as Feature<MultiLineString>);
      }
    });

    // Convert input multiline strings into linestrings
    multilineStrings.forEach((multilineString: any) => {
      const newLineStrings: Feature<LineString>[] = [];
      flattenEach(multilineString, (currentFeature: Feature<LineString>) => {
        if (currentFeature.geometry.type === 'LineString') {
          const pointOnLineForStart = nearestPointOnLine(currentFeature, point(start));
          const distanceForStart = turfDistance(pointOnLineForStart, point(start));
          if (distanceForStart < closestStartDistance) {
            pointOnStartLine = pointOnLineForStart.geometry.coordinates;
            closestStartDistance = distanceForStart;
            startLineIndex = linestrings.length + newLineStrings.length;
          }
          const pointOnLineForEnd = nearestPointOnLine(currentFeature, point(end));
          const distanceForEnd = turfDistance(pointOnLineForEnd, point(end));
          if (distanceForEnd < closestEndDistance) {
            pointOnEndLine = pointOnLineForEnd.geometry.coordinates;
            closestEndDistance = distanceForEnd;
            endLineIndex = linestrings.length + newLineStrings.length;
          }
          newLineStrings.push(currentFeature);
        }
      });
      linestrings = [...linestrings, ...newLineStrings];
    });

    if (closestStartDistance > 40 || closestEndDistance > 40) {
      console.log('start or end point too far from rivers');
      this.isTooFarFromRivers = true;
      this.network = new Map();
      return;
    }

    // edit the linestrings that coorespond with the startLineIndex and endLineIndex
    if (pointOnStartLine) {
      linestrings[startLineIndex].geometry.coordinates = this.insertPointIntoLineString(linestrings[startLineIndex], pointOnStartLine).updatedLine!.geometry.coordinates;
    }
    if (pointOnEndLine) {
      linestrings[endLineIndex].geometry.coordinates = this.insertPointIntoLineString(linestrings[endLineIndex], pointOnEndLine).updatedLine!.geometry.coordinates;
    }
    if (pointOnStartLine && pointOnEndLine) {
      linestrings.push(lineString([pointOnStartLine, start]));
      linestrings.push(lineString([pointOnEndLine, end]));
    }

    this.network = this.buildNetwork(linestrings);
  }

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
      for (let j = i + 1; j < linestrings.length; j++) {
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
            const newLineString = this.insertPointIntoLineString(newLinestrings.get(`${i}`)!, intersection);
            if (newLineString.success) {
              newLinestrings.set(`${i}`, newLineString.updatedLine!);
            }
            const newLineString2 = this.insertPointIntoLineString(newLinestrings.get(`${j}`)!, intersection);
            if (newLineString2.success) {
              newLinestrings.set(`${j}`, newLineString2.updatedLine!);
            }
          });
        }
      }
    }

    return [...newLinestrings.values()];
  }

  insertPointIntoLineString(line: Feature<LineString>, newPoint: number[]): { updatedLine: Feature<LineString> | null, success: boolean } {
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
    formattedLineStrings.forEach(linestring => {
      // since we've accounted for intersections in our formatted linestrings, each neighbor in this loop is guaranteed to be connected
      const coords = linestring.geometry.coordinates;
      // go through each coord and add it to the graph with its previous and next as neighbors w/weights
      for (let i = 0; i < coords.length; i++) {
        const coord = coords[i];
        const key = this.coordToKey(coord);
        const prevCoord: number[] | null = i === 0 ? null : coords[i - 1];
        const nextCoord: number[] | null = i === coords.length - 1 ? null : coords[i + 1];

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
    });

    return graph;
  }


  dijkstra(graph: Graph, source: string, target: string): { path: string[], distance: number } {

    // skip this process if the source is too far from rivers
    if (this.isTooFarFromRivers) {
      return {
        path: [],
        distance: Infinity
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

  findShortestPath = (start: number[], end: number[]): { path: Feature<LineString>, distance: number } => {

    const { distance, path } = this.dijkstra(this.network, this.coordToKey(start), this.coordToKey(end));

    // if a route isn't found, connect the start and end points
    if (distance === Infinity) {
      return { path: lineString([start, end]), distance: turfDistance(point(start), point(end)) };
    }

    const formattedPath = path.map(coord => {
      const [x, y] = coord.split(',').map(Number);
      return [x, y];
    });

    return { path: lineString(formattedPath), distance };
  };

}

const test = () => {

  const line1 = lineString([
    [
      -111.85376055660758,
      40.76038720145661
    ],
    [
      -111.84621855496208,
      40.75323855798587
    ],
    [
      -111.85944407658616,
      40.74310844900381
    ],
    [
      -111.83857999458694,
      40.72773626658861
    ],
    [
      -111.85069577576085,
      40.72502998795909
    ]
  ]);
  const line2 = lineString([
    [
      -111.84465142826285,
      40.75834809190411
    ],
    [
      -111.8546278118561,
      40.754557310495926
    ],
    [
      -111.84920194333104,
      40.747110124075874
    ],
    [
      -111.83852071753277,
      40.74478965990912
    ],
    [
      -111.85518626316455,
      40.73397762393603
    ],
    [
      -111.87562887027482,
      40.73592963853403
    ]
  ])


  const s = [
    -111.79593362711739,
    40.412463134612096
  ]
  const e = [
    -111.90822306859323,
    40.42614375107934
  ]

  const pathFinder = new LinestringPathFinder([line1, line2], s, e);

  const { path, distance } = pathFinder.findShortestPath(s, e);

  console.log(path, distance);

}

test();