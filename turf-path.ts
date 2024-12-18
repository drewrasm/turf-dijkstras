import { Feature, LineString, lineString, MultiLineString, point } from '@turf/helpers';
import turfDistance from '@turf/distance';
import { flattenEach } from "@turf/meta";
import lineIntersect from "@turf/line-intersect";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import pointToLineDistance from '@turf/point-to-line-distance';


/*
  * Take multiline strings and convert into linestrings
  * Convert linestrings into a network of connected points
  * Find shortest path between two points
 */


type Node = string;
type Edge = { target: Node; weight: number };
type Graph = Map<Node, Edge[]>;

export default class LinestringPathFinder {
  network: Graph;
  constructor(multiLinestrings: Feature<MultiLineString | LineString>[], start: number[], end: number[]) {

    // handling start and end:
    /*
      * create a linestring from start to nearest linestring in collection
      * create a linestring from nearest linestring in collection to end
      * take those two points and insert them into those connected linestrings
      * add the new formatted linestrings as well as the start and end linestrings to the network 
    */

    // Convert input multilinestrings into linestrings by making two collections. One for linestrings and one for multiline strings
    // while looping through, find the closest linestring to the start and end points
    let linestrings: Feature<LineString>[] = [];
    const multilineStrings: Feature<MultiLineString>[] = [];
    multiLinestrings.forEach((linestring) => {
      if (linestring.geometry.type === 'LineString') {

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
          newLineStrings.push(currentFeature);
        }
      });
      linestrings = [...linestrings, ...newLineStrings];
    });

    this.network = this.buildNetwork(linestrings);
  }

  /**
 * Converts a coordinate to a string key (e.g., [x, y] -> "x,y")
 */
  coordToKey(coord: number[]): string {
    return `${coord[0]},${coord[1]}`;
  }

  // Helper function to find the closest points on two lines. This helps construct the graph for intersecting points.
  getClosestPointsForLine(line: Feature<LineString>, intersectionPoint: number[]): { before: Edge | null, after: Edge | null } {
    const lineCoords = line.geometry.coordinates;
    let before = null;
    let after = null;

    // Find the two closest points (before and after the intersection)
    for (let i = 0; i < lineCoords.length - 1; i++) {
      const segmentStart = lineCoords[i];
      const segmentEnd = lineCoords[i + 1];

      // Calculate the distance from the intersection to the segment start and end
      let distToStart = turfDistance(intersectionPoint, segmentStart);
      let distToEnd = turfDistance(intersectionPoint, segmentEnd);

      if (distToStart < distToEnd) {
        // Select the closest before and after points based on distance
        if (!before || distToStart < turfDistance(intersectionPoint, before.target)) {
          before = { target: segmentStart, weight: distToStart };
        }
        if (!after || distToEnd < turfDistance(intersectionPoint, after.target)) {
          after = { target: segmentEnd, weight: distToEnd };
        }
      } else {
        if (!before || distToEnd < turfDistance(intersectionPoint, before.target)) {
          before = { target: segmentEnd, weight: distToEnd };
        }
        if (!after || distToStart < turfDistance(intersectionPoint, after.target)) {
          after = { target: segmentStart, weight: distToStart };
        }
      }
    }

    if (before?.weight === 0 || before?.weight === null) {
      before = null;
    }
    if (after?.weight === 0 || after?.weight === null) {
      after = null;
    }

    const formattedBefore = before ? { target: this.coordToKey(before.target), weight: before.weight } : null;
    const formattedAfter = after ? { target: this.coordToKey(after.target), weight: after.weight } : null;

    return { before: formattedBefore, after: formattedAfter };
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
            console.log("newLineString", JSON.stringify(newLineString));
            const newLineString2 = this.insertPointIntoLineString(newLinestrings.get(`${j}`)!, intersection);
            if (newLineString2.success) {
              newLinestrings.set(`${j}`, newLineString2.updatedLine!);
            }
            console.log("newLineString2", JSON.stringify(newLineString2));
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


  dijkstra(graph: Graph, source: string, target: string) {
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

  findShortestPath = (start: number[], end: number[]): { path: Node[], distance: number } => {

    const { distance, path } = this.dijkstra(this.network, this.coordToKey(start), this.coordToKey(end));

    return { path, distance };
  };

}

const test = () => {

  const line1 = lineString([
    [
      -111.86516756409644,
      40.77003545080544
    ],
    [
      -111.86512954813114,
      40.725010814740386
    ]
  ]);
  const line2 = lineString([
    [
      -111.88850777645592,
      40.75010189571543
    ],
    [
      -111.829576856461,
      40.750967496930315
    ]
  ])
  const line3 = lineString([
    [
      -111.84025605848765,
      40.753824397626715
    ],
    [
      -111.84000201774212,
      40.73922492783112
    ]
  ])
  const line4 = lineString([
    [
      -111.88306010479505,
      40.73160091837579
    ],
    [
      -111.85631653642979,
      40.73104977445652
    ],
    [
      -111.85207145971464,
      40.74024293098353
    ],
    [
      -111.83276652931693,
      40.7456156372628
    ],
    [
      -111.82357920212552,
      40.74204578913225
    ],
    [
      -111.8124112507476,
      40.755486952525615
    ]
  ])

  const s = [
    -111.86516756409644,
    40.77003545080544
  ];
  const e =  [
    -111.83276652931693,
    40.7456156372628
  ]

  const pathFinder = new LinestringPathFinder([line1, line2, line3, line4], s, e);

  const { path, distance } = pathFinder.findShortestPath(s, e);

  console.log(path, distance);

}

test();