import { Feature, LineString, lineString, MultiLineString, point } from '@turf/helpers';
import turfDistance from '@turf/distance';
import { flattenEach } from "@turf/meta";
import lineIntersect from "@turf/line-intersect";
import nearestPointOnLine from "@turf/nearest-point-on-line";


/*
  * Take multiline strings and convert into linestrings
  * Convert linestrings into a network of connected points
  * Find shortest path between two points
 */


type Node = string;
type Edge = { target: Node; weight: number };
type Graph = Map<Node, Edge[]>;

type InitialPointInfo = {
  origin: number[];
  lineString: Feature<LineString>;
  distance: number;
  pointOnLine: number[];
}

export default class LinestringPathFinder {
  network: Graph;
  startInfo: InitialPointInfo;
  endInfo: InitialPointInfo;
  constructor(multiLinestrings: Feature<MultiLineString | LineString>[], start: number[], end: number[]) {
    let closestLineStringStartPoint: number[] | null = null;
    let closestToStartDistance = Infinity;

    let closestLineStringEndPoint: number[] | null = null;
    let cloestToEndDistance = Infinity;

    // Convert input multilinestrings into linestrings by making two collections. One for linestrings and one for multiline strings
    // while looping through, find the closest linestring to the start and end points
    let linestrings: Feature<LineString>[] = [];
    const multilineStrings: Feature<MultiLineString>[] = [];
    multiLinestrings.forEach((linestring) => {
      if (linestring.geometry.type === 'LineString') {
        const pointOnLineForStart = nearestPointOnLine(linestring, point(start));
        const distanceForStart = turfDistance(pointOnLineForStart, point(start));
        if (distanceForStart < closestToStartDistance) {
          closestLineStringStartPoint = pointOnLineForStart.geometry.coordinates;
          closestToStartDistance = distanceForStart;
        }
        const pointOnLineForEnd = nearestPointOnLine(linestring, point(end));
        const distanceForEnd = turfDistance(pointOnLineForEnd, point(end));
        if (distanceForEnd < cloestToEndDistance) {
          closestLineStringEndPoint = pointOnLineForEnd.geometry.coordinates;
          cloestToEndDistance = distanceForEnd;
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
          if (distanceForStart < closestToStartDistance) {
            closestLineStringStartPoint = pointOnLineForStart.geometry.coordinates;
            closestToStartDistance = distanceForStart;
          }
          const pointOnLineForEnd = nearestPointOnLine(currentFeature, point(end));
          const distanceForEnd = turfDistance(pointOnLineForEnd, point(end));
          if (distanceForEnd < cloestToEndDistance) {
            closestLineStringEndPoint = pointOnLineForEnd.geometry.coordinates;
            cloestToEndDistance = distanceForEnd;
          }
          newLineStrings.push(currentFeature);
        }
      });
      linestrings = [...linestrings, ...newLineStrings];
    });

    if (!closestLineStringStartPoint) {
      console.log('closest line string point not found')
    }
    const startToNearestLineString = lineString([start, closestLineStringStartPoint ? closestLineStringStartPoint : start]);

    if (!closestLineStringEndPoint) {
      console.log('closest line string point not found')
    }
    const endToNearestLineString = lineString([closestLineStringEndPoint ? closestLineStringEndPoint : end, end]);

    this.startInfo = {
      origin: start,
      lineString: startToNearestLineString,
      distance: closestToStartDistance,
      pointOnLine: closestLineStringStartPoint ? closestLineStringStartPoint : start
    }
    this.endInfo = {
      origin: end,
      lineString: endToNearestLineString,
      distance: cloestToEndDistance,
      pointOnLine: closestLineStringEndPoint ? closestLineStringEndPoint : end
    }

    this.network = this.buildNetwork(linestrings);
  }

  /**
 * Converts a coordinate to a string key (e.g., [x, y] -> "x,y")
 */
  coordToKey(coord: number[]): string {
    return `${coord[0]},${coord[1]}`;
  }

  // Helper function to find neighboring points on a line
  getDirectionalNeighbors(line1: Feature<LineString>, line2: Feature<LineString>, intersectionPoint: number[]): [Edge[], Map<Node, Edge[]>] {
    const neighbors: Edge[] = [];
    // possible corrections is an array of edges that corresponds to possibilities in the original graph where a neighbor no longer is a neighbor
    // if an intersection disrupts two neighbors, they're no longer neighbors
    const possibleCorrections: Map<Node, Edge[]> = new Map();

    const { before: line1Before, after: line1After } = this.getClosestPointsForLine(line1, intersectionPoint)
    const { before: line2Before, after: line2After } = this.getClosestPointsForLine(line2, intersectionPoint)

    if (line1Before) {
      neighbors.push(line1Before);
    }
    if (line1After) {
      neighbors.push(line1After);
    }

    if (line1Before && line1After) {
      possibleCorrections.set(line1Before.target, [{ target: line1After.target, weight: line1After.weight + line1Before.weight }]);
      possibleCorrections.set(line1After.target, [{ target: line1Before.target, weight: line1After.weight + line1Before.weight }]);
    }

    if (line2Before) {
      neighbors.push(line2Before);
    }
    if (line2After) {
      neighbors.push(line2After);
    }

    if (line2Before && line2After) {
      possibleCorrections.set(line2Before.target, [{ target: line2After.target, weight: line2After.weight + line2Before.weight }]);
      possibleCorrections.set(line2After.target, [{ target: line2Before.target, weight: line2After.weight + line2Before.weight }]);
    }

    return [neighbors, possibleCorrections];
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


  getIntersections(linestrings: Feature<LineString>[]): { coords: number[]; neighbors: Edge[], corrections: Map<Node, Edge[]> }[] {
    // change this so that per intersection we have the corrections


    // Function to calculate intersection details
    const intersections: { coords: number[]; neighbors: Edge[], corrections: Map<Node, Edge[]> }[] = []


    // Iterate through each pair of linestrings
    for (let i = 0; i < linestrings.length; i++) {
      for (let j = i + 1; j < linestrings.length; j++) {
        if (i !== j) {
          // Get intersection points
          const intersectPoints = lineIntersect(linestrings[i], linestrings[j]);

          intersectPoints.features.forEach((p) => {
            const intersection = p.geometry.coordinates;
            // Find the neighboring points on each linestring
            const [neighbors, possibleCorrections] = this.getDirectionalNeighbors(linestrings[i], linestrings[j], intersection);
            intersections.push({ coords: intersection, neighbors, corrections: possibleCorrections });

          });
        }
      }
    }

    return intersections;
  }


  handleStartAndEndInfo(graph: Graph) {

    const startKey = this.coordToKey(this.startInfo.origin);
    const endKey = this.coordToKey(this.endInfo.origin);
    const startOnLineKey = this.coordToKey(this.startInfo.pointOnLine);
    const endOnLineKey = this.coordToKey(this.endInfo.pointOnLine);

    if (!graph.has(startKey)) {
      graph.set(startKey, []);
    }
    if (!graph.has(endKey)) {
      graph.set(endKey, []);
    }
    if (!graph.has(startOnLineKey)) {
      graph.set(startOnLineKey, []);
    }
    if (!graph.has(endOnLineKey)) {
      graph.set(endOnLineKey, []);
    }

    graph.get(startKey)?.push({ target: startOnLineKey, weight: this.startInfo.distance });
    graph.get(endKey)?.push({ target: endOnLineKey, weight: this.endInfo.distance });

    const { before: startBefore, after: startAfter } = this.getClosestPointsForLine(this.startInfo.lineString, this.startInfo.pointOnLine);
    graph.get(startOnLineKey)?.push({ target: startKey, weight: this.startInfo.distance });
    if (startBefore && (startKey !== startOnLineKey) && (startKey !== startBefore?.target)) {
      graph.get(startOnLineKey)?.push(startBefore);
    }
    if (startAfter && (startKey !== startOnLineKey) && (startKey !== startAfter?.target)) {
      graph.get(startOnLineKey)?.push(startAfter);
    }

    const { before: endBefore, after: endAfter } = this.getClosestPointsForLine(this.endInfo.lineString, this.endInfo.pointOnLine);
    graph.get(endOnLineKey)?.push({ target: endKey, weight: this.endInfo.distance });
    if (endBefore && (endKey !== endOnLineKey) && (endKey !== endBefore?.target)) {
      graph.get(endOnLineKey)?.push(endBefore);
    }
    if (endAfter && (endKey !== endOnLineKey) && (endKey !== endAfter?.target)) {
      graph.get(endOnLineKey)?.push(endAfter);
    }
  }

  /**
  * Builds a graph from an array of LineString features
  * @param linestrings - Array of GeoJSON LineString features
  * @returns An adjacency list representing the graph
  */
  buildNetwork(linestrings: Feature<LineString>[]): Graph {
    // for each linestring, we need a record of the linestrings that intersect it and at what points
    // we need to make a record of those points and the neighbors of those points
    // then we ned to give those neighbors weights and include them in the graph

    // for both the start and end point, we need to figure out the neighbors
    // this will end up being the start of the whole graph

    const graph: Graph = new Map();

    // this.handleStartAndEndInfo(graph);

    // console.log('startInfo linestring', JSON.stringify(this.startInfo.lineString));
    // console.log('endInfo linestring', JSON.stringify(this.endInfo.lineString));

    linestrings.forEach(linestring => {
      // for each linestring, we need to figure out their neighbors.
      // their neighbors, I'm pretty sure, are just the next and previous points on the linestring.

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

    const intersections = this.getIntersections(linestrings);

    for (let i = 0; i < intersections.length; i++) {
      const intersection = intersections[i];
      const key = this.coordToKey(intersection.coords);
      if (!graph.has(key)) {
        graph.set(key, []);
      }
      for (let j = 0; j < intersection.neighbors.length; j++) {
        const neighbor = intersection.neighbors[j];
        if (!graph.has(neighbor.target)) {
          graph.set(neighbor.target, []);
        }
        graph.get(neighbor.target)?.push({ target: key, weight: neighbor.weight });
      }
      graph.get(key)?.push(...intersection.neighbors);
      // map through intersection.corrections and remove the edges from the graph
      for (let [key, edges] of intersection.corrections) {
        const currentEdgesToCorrect = graph.get(key);
        if (currentEdgesToCorrect && currentEdgesToCorrect.length > 0) {
          for (let edge of edges) {
            currentEdgesToCorrect.forEach((edgeToCorrect, index) => {
              if (edgeToCorrect.target === edge.target && edgeToCorrect.weight.toFixed(6) === edge.weight.toFixed(6)) {
                currentEdgesToCorrect.splice(index, 1);
              }
            })
          }
        }
      }
    }

    console.log('graph', graph);

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
  const line2 = lineString([[
    -111.88850777645592,
    40.75010189571543
  ],
  [
    -111.829576856461,
    40.750967496930315
  ]])
  const line3 = lineString([
    [
      -111.84355466180223,
      40.75868302964949
    ],
    [
      -111.84221125597901,
      40.737387999134256
    ],
    [
      -111.84930007130968,
      40.729128425152965
    ],
    [
      -111.83443926908637,
      40.72798035279712
    ]
  ])

  const s = [-111.86516756409644, 40.77003545080544];
  const e = [
    -111.83443926908637,
    40.72798035279712
  ]

  // TODDO - get this next example working (the previous with just the first two lines worked fine)


  const pathFinder = new LinestringPathFinder([line1, line2, line3], s, e);

  const { path, distance } = pathFinder.findShortestPath(s, e);

  console.log(path, distance);

}

test();



// verifying what works

/*
  constructor - pretty sure it works, the linestrings look great on geojson.io
    IDK - we need to be able to force the two start linestrings to be included into the network somehow
    Right now the stupid nearest point function doesn't necessarily always constitute an intersection which is wackadoodle idk
    

  coordToKey - works

  getIntersections - works but dosn't with lines that apparently don't intersect lol

  start and end points - not sure yet. I think it's broken. Should probably focus on the whole thing working without those pesky start and end points first

*/