import { Feature, LineString, lineString, MultiLineString, point, Position } from '@turf/helpers';
import turfDistance from '@turf/distance';
import { flattenEach } from "@turf/meta";
import lineIntersect from "@turf/line-intersect";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import pointToLineDistance from "@turf/point-to-line-distance";


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
  getDirectionalNeighbors(line1: Feature<LineString>, line2: Feature<LineString>, intersectionPoint: number[]): Edge[] {
    const neighbors: Edge[] = [];

    const { before: line1Before, after: line1After } = this.getClosestPointsForLine(line1, intersectionPoint)
    const { before: line2Before, after: line2After } = this.getClosestPointsForLine(line2, intersectionPoint)

    if (line1Before) {
      neighbors.push(line1Before);
    }
    if (line1After) {
      neighbors.push(line1After);
    }
    if (line2Before) {
      neighbors.push(line2Before);
    }
    if (line2After) {
      neighbors.push(line2After);
    }

    return neighbors;
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


  getIntersections(linestrings: Feature<LineString>[]): { coords: number[]; neighbors: Edge[] }[] {
    // Function to calculate intersection details
    const intersections: { coords: number[]; neighbors: Edge[] }[] = []

    // Iterate through each pair of linestrings
    for (let i = 0; i < linestrings.length; i++) {
      for (let j = i + 1; j < linestrings.length; j++) {
        if (i !== j) {
          // Get intersection points
          const intersectPoints = lineIntersect(linestrings[i], linestrings[j]);

          intersectPoints.features.forEach((p) => {
            const intersection = p.geometry.coordinates;

            // Find the neighboring points on each linestring
            const neighbors = this.getDirectionalNeighbors(linestrings[i], linestrings[j], intersection);
            intersections.push({ coords: intersection, neighbors })

          });
        }
      }
    }

    return intersections
  }


  handleStartAndEndInfo() {
    const graph: Graph = new Map();

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

    return graph
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
    const graph = this.handleStartAndEndInfo();


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
    }

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

    return graph;
  }


  dijkstra(graph: Graph, start: Node, end: Node): { path: Node[], distance: number } {
    const distances = new Map<Node, number>();
    const visited = new Set<Node>();
    const predecessors = new Map<Node, Node>();
    const priorityQueue: [Node, number][] = [];

    // Initialize distances and priority queue
    const allNodes = new Set<Node>();
    graph.forEach((edges, node) => {
      allNodes.add(node);
      edges.forEach(edge => allNodes.add(edge.target));
    });

    allNodes.forEach(node => distances.set(node, Infinity));

    distances.set(start, 0);
    priorityQueue.push([start, 0]);

    // Main loop
    while (priorityQueue.length > 0) {
      // Sort the queue to maintain priority
      priorityQueue.sort((a, b) => a[1] - b[1]);
      const [currentNode, currentDistance] = priorityQueue.shift()!;

      // If the node is already visited, skip it
      if (visited.has(currentNode)) {
        continue;
      }
      visited.add(currentNode);

      if (currentNode === end) {
        break;
      }

      // Process neighbors
      const edges = graph.get(currentNode) || [];
      for (const { target, weight } of edges) {
        const newDistance = currentDistance + weight;

        if (newDistance < (distances.get(target) || Infinity)) {
          distances.set(target, newDistance);
          priorityQueue.push([target, newDistance]);
          predecessors.set(target, currentNode);
        }
      }
    }

    const path: Node[] = [];
    let node: Node | undefined = end;

    while (node !== undefined) {
      path.unshift(node);
      node = predecessors.get(node);
    }

    return { distance: distances.get(end) || 0, path };
  }


  findShortestPath = (start: number[], end: number[]): { path: Node[], distance: number } => {

    const { distance, path } = this.dijkstra(this.network, this.coordToKey(start), this.coordToKey(end));

    return { path, distance };
  };

}

const test = () => {


  // const linestring1 = lineString([
  //   [-111.8902, 40.7608], // 500 W 100 S
  //   [-111.8902, 40.7708]  // 500 W 200 S
  // ]);

  // const linestring2 = lineString([
  //   [-111.8802, 40.7658], // 600 W 150 S
  //   [-111.9002, 40.7658]  // 400 W 150 S
  // ]);

  // const linestring3 = lineString([
  //   [-111.8902, 40.7558], // 500 W 50 S
  //   [-111.8902, 40.7858]  // 500 W 250 S
  // ]);

  // const linestring4 = lineString([
  //   [-111.8702, 40.7708], // 700 W 200 S
  //   [-111.9102, 40.7708]  // 300 W 200 S
  // ]);

  // const linestring5 = lineString([
  //   [-111.8902, 40.7808], // 500 W 300 S
  //   [-111.8902, 40.7908]  // 500 W 400 S
  // ]);

  // const linestrings = [linestring1, linestring2, linestring3, linestring4, linestring5];

  const line2 = lineString([
    [-111.8902, 40.7634],
    [-111.8902, 40.7908]
  ]);

  const line4 = lineString([
    [-111.89572534700311, 40.779711453317816],
    [-111.88920800121039, 40.78164506327522],
    [-111.88044198055394, 40.77927854785486],
    [-111.87903179462201, 40.780144355960005]
  ]);

  const s = [-111.8912, 40.7644]

  const e = [-111.87923179462201, 40.780154355960005]


  const pathFinder = new LinestringPathFinder([line2, line4], s, e);

  const shortestPath = pathFinder.findShortestPath(s, e);

  console.log(shortestPath)

}

test();



// verifying what works

/*
  constructor - pretty sure it works, the linestrings look great on geojson.io
    IDK - we need to be able to force the two start linestrings to be included into the network somehow
    Right now the stupid nearest point function doesn't necessarily always constitute an intersection which is wackadoodle idk
    

  coordToKey - works

  getIntersections - works but dosn't with lines that apparently don't intersect lol
*/