import { Feature, LineString, lineString, MultiLineString, point } from '@turf/helpers';
import turfDistance from '@turf/distance';
import { flattenEach } from "@turf/meta";
import lineIntersect from "@turf/line-intersect";
import nearestPointOnLine from "@turf/nearest-point-on-line";
import pointToLineDistance from '@turf/point-to-line-distance';

// TODO: still needs to just return a straight line if there is no path
// TODO: needs to have a limit on how close you have to have your start and end points to rivers.
// TODO: the final path should be a linestring 


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
  isTooFarFromRivers: boolean = false;
  constructor(multiLinestrings: Feature<MultiLineString | LineString>[], start: number[], end: number[]) {
    let closestStartDistance = Infinity;
    let closestEndDistance = Infinity;
    let startLineIndex = -1;
    let endLineIndex = -1;
    let pointOnStartLine = null;
    let pointOnEndLine = null;
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

    if(closestStartDistance > 40 || closestEndDistance > 40){
      console.log('start or end point too far from rivers');
      this.isTooFarFromRivers = true;
      this.network = new Map();
      return;
    }

    // edit the linestrings that coorespond with the startLineIndex and endLineIndex
    if(pointOnStartLine) {
      linestrings[startLineIndex].geometry.coordinates = this.insertPointIntoLineString(linestrings[startLineIndex], pointOnStartLine).updatedLine!.geometry.coordinates;
    }
    if(pointOnEndLine){
      linestrings[endLineIndex].geometry.coordinates = this.insertPointIntoLineString(linestrings[endLineIndex], pointOnEndLine).updatedLine!.geometry.coordinates;
    }
    if(pointOnStartLine && pointOnEndLine){
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

    if(this.isTooFarFromRivers){
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

    if(this.isTooFarFromRivers){
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

    if(distance === Infinity) {
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
 

  const s =  [
    -111.79593362711739,
    40.412463134612096
  ]
  const e =  [
    -111.90822306859323,
    40.42614375107934
  ]

const thing =  [{"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Cutthroat Trout\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":127400.65125750538,"access":2,"amenities":0,"name":"Jordan River","river_id":"3670ddb6-9830-40fe-ad18-b82b64390aec","retail":1,"flow_site":0,"hazard":0,"boat_ramp":7,"lodging":0,"uuid":"997ba9b4-d847-4498-bf6c-6a8095516ea0","stream_order":7,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0},"type":"Feature","geometry":{"coordinates":[[[-111.91497802734375,40.43740999093242],[-111.91308975219727,40.439500423133325],[-111.91411972045898,40.44028431845115]],[[-111.9228744506836,40.44276659332212],[-111.9228744506836,40.44289723682891]],[[-111.85558319091797,40.32508451346658],[-111.86399459838867,40.32822537016227],[-111.87532424926758,40.32966488063602],[-111.88373565673828,40.333852372891954],[-111.88785552978516,40.33882468245787],[-111.88957214355469,40.350468920734926]],[[-111.89472198486328,40.35923348176084],[-111.89695358276367,40.35949509293718],[-111.89798355102539,40.360541527490994]],[[-111.91411972045898,40.44028431845115],[-111.92081451416016,40.441460144289465]],[[-111.89197540283203,40.41480304205038],[-111.89695358276367,40.42029213268896],[-111.89884185791016,40.41924662614147],[-111.89987182617188,40.41963869300082]],[[-111.92098617553711,40.441460144289465],[-111.92098617553711,40.44159079033528]],[[-111.89798355102539,40.360541527490994],[-111.90038681030273,40.36224194899873],[-111.9038200378418,40.36237274887662],[-111.90330505371094,40.36538107602172],[-111.90605163574219,40.36865084455408]],[[-111.90244674682617,40.393103682141316],[-111.89661026000977,40.394803282054795],[-111.89472198486328,40.3971565034218],[-111.8986701965332,40.400294003974835],[-111.8983268737793,40.40147052898621],[-111.89643859863281,40.40212414510788],[-111.89764022827148,40.40277775488329]],[[-111.90536499023438,40.370220277106085],[-111.90776824951172,40.37165889150609],[-111.90485000610352,40.37558222923349],[-111.90828323364258,40.37728227130896],[-111.90828323364258,40.378720734946484],[-111.91377639770508,40.38028993297911],[-111.90622329711914,40.38578183826232],[-111.90296173095703,40.38525881895441]],[[-111.80322647094727,40.2753348073247],[-111.8136978149414,40.29615558909887],[-111.8301773071289,40.31186513985341]],[[-111.9038200378418,40.427740896531304],[-111.90605163574219,40.428524928952044],[-111.90828323364258,40.426042128264925],[-111.90914154052734,40.428132913884156],[-111.91274642944336,40.43166096723547],[-111.91497802734375,40.43166096723547],[-111.91497802734375,40.43740999093242]],[[-111.83258056640625,40.316315515014736],[-111.84528350830078,40.3198494275247]],[[-111.80013656616211,40.22253391324571],[-111.79601669311523,40.24022614566749],[-111.7965316772461,40.24821889758465]],[[-111.90296173095703,40.38525881895441],[-111.90210342407227,40.38617410007811],[-111.90536499023438,40.38682786469454],[-111.90605163574219,40.38983510019756],[-111.90244674682617,40.393103682141316]],[[-111.89987182617188,40.41963869300082],[-111.90004348754883,40.42316719191561],[-111.90296173095703,40.42551942170479],[-111.9038200378418,40.427740896531304]],[[-111.9228744506836,40.44289723682891],[-111.91978454589844,40.44955971899029]],[[-111.8133544921875,40.19500347683447],[-111.80168151855469,40.21440704301]],[[-111.79584503173828,40.26092673987989],[-111.80322647094727,40.2753348073247]],[[-111.80168151855469,40.21440704301],[-111.80013656616211,40.22253391324571]],[[-111.7965316772461,40.24821889758465],[-111.79584503173828,40.26092673987989]],[[-111.88957214355469,40.350468920734926],[-111.88819885253906,40.357402175102465]],[[-111.90605163574219,40.36865084455408],[-111.90536499023438,40.370220277106085]],[[-111.88819885253906,40.357402175102465],[-111.89231872558594,40.35923348176084],[-111.89472198486328,40.35923348176084]],[[-111.92098617553711,40.44159079033528],[-111.9228744506836,40.44276659332212]],[[-111.92081451416016,40.441460144289465],[-111.92098617553711,40.441460144289465]],[[-111.8301773071289,40.31186513985341],[-111.83258056640625,40.316315515014736]],[[-111.84528350830078,40.3198494275247],[-111.85558319091797,40.32508451346658]],[[-111.89764022827148,40.40277775488329],[-111.9009017944336,40.402647033435926],[-111.90313339233398,40.4035620782368],[-111.89901351928711,40.40669928026412],[-111.89678192138672,40.41048987095917],[-111.89437866210938,40.41048987095917],[-111.89266204833984,40.411796921696265],[-111.89197540283203,40.41480304205038]]],"type":"MultiLineString"},"id":8018432553164701},{"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":23567.065017847453,"stream_order":4,"access":0,"amenities":0,"boat_ramp":0,"lodging":0,"uuid":"af3eefbb-ddee-448b-9a0c-0be68ffdf888","hazard":0,"flow_site":0,"retail":0,"river_id":"b6ae9249-e475-4e9f-a87a-501d2b2c3156","name":"Dry Creek","max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0},"type":"Feature","id":3738667379433905,"geometry":{"coordinates":[[[-111.86227798461914,40.383558978156174],[-111.86691284179688,40.378720734946484]],[[-111.83687210083008,40.4185931762984],[-111.84322357177734,40.4138881500721],[-111.84820175170898,40.412319734882914],[-111.85094833374023,40.41009775078777],[-111.85111999511719,40.404869263517895],[-111.84991836547852,40.40225486757066],[-111.85111999511719,40.39990182440178]],[[-111.82193756103516,40.427871569236146],[-111.8269157409668,40.423820597330376],[-111.8294906616211,40.42355923592609],[-111.83223724365234,40.42042281986497],[-111.8353271484375,40.420161445259055],[-111.83687210083008,40.4185931762984]],[[-111.85094833374023,40.39964037008389],[-111.85009002685547,40.39872527197505],[-111.85026168823242,40.39401885665606],[-111.85953140258789,40.38905061692466],[-111.86176300048828,40.38865837186151],[-111.86227798461914,40.383558978156174]],[[-111.82039260864258,40.428524928952044],[-111.82125091552734,40.428132913884156]],[[-111.81060791015625,40.43597278109024],[-111.81198120117188,40.43375157817948],[-111.81816101074219,40.430484970016664]],[[-111.81816101074219,40.430484970016664],[-111.81936264038086,40.42930895223287]],[[-111.79567337036133,40.4397617225882],[-111.8082046508789,40.43727933676172],[-111.81060791015625,40.43597278109024]],[[-111.86691284179688,40.378720734946484],[-111.8682861328125,40.37741304199963],[-111.87429428100586,40.37558222923349],[-111.87429428100586,40.37401292155377],[-111.87686920166016,40.370612629533554],[-111.87944412231445,40.37074341316844],[-111.88373565673828,40.366819793718406],[-111.88253402709961,40.36041072406002]],[[-111.88253402709961,40.36041072406002],[-111.88304901123047,40.358187026904034],[-111.88819885253906,40.357402175102465]],[[-111.85111999511719,40.39990182440178],[-111.85094833374023,40.39964037008389]],[[-111.81936264038086,40.42930895223287],[-111.82039260864258,40.428524928952044]],[[-111.79344177246094,40.4413294979897],[-111.79567337036133,40.4397617225882]],[[-111.82125091552734,40.428132913884156],[-111.82193756103516,40.427871569236146]]],"type":"MultiLineString"}},{"geometry":{"coordinates":[[[-111.8269157409668,40.38538957416213],[-111.8272590637207,40.38277442178142]],[[-111.83481216430664,40.40016327770431],[-111.82863235473633,40.393495901313514]],[[-111.80683135986328,40.426303480021716],[-111.80957794189453,40.42734887689349],[-111.81713104248047,40.423428554843156],[-111.82571411132812,40.417939720108535],[-111.82588577270508,40.41493373988894]],[[-111.82828903198242,40.39323442211918],[-111.82571411132812,40.390488829277956]],[[-111.82914733886719,40.40918279483603],[-111.82914733886719,40.4086599572787]],[[-111.82657241821289,40.41454164561162],[-111.82794570922852,40.41310394704706],[-111.82743072509766,40.41075128313747],[-111.82914733886719,40.40918279483603]],[[-111.82811737060547,40.381989856269115],[-111.82931900024414,40.38028993297911]],[[-111.82931900024414,40.38028993297911],[-111.82914733886719,40.379897636897454]],[[-111.83343887329102,40.40552284663897],[-111.83378219604492,40.40499998064982]],[[-111.82571411132812,40.390488829277956],[-111.8269157409668,40.38538957416213]],[[-111.82588577270508,40.41493373988894],[-111.82657241821289,40.41454164561162]],[[-111.82914733886719,40.4086599572787],[-111.82914733886719,40.4077449817799],[-111.83343887329102,40.40552284663897]],[[-111.82863235473633,40.393495901313514],[-111.82828903198242,40.39323442211918]],[[-111.8272590637207,40.38277442178142],[-111.82811737060547,40.381989856269115]],[[-111.83378219604492,40.40499998064982],[-111.83481216430664,40.40343135831253],[-111.83481216430664,40.40016327770431]]],"type":"MultiLineString"},"id":8484031421263078,"type":"Feature","properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":7236.204139603133,"access":0,"amenities":0,"retail":0,"river_id":"d7c21197-4f6f-475f-8664-01ec7dfde229","flow_site":0,"boat_ramp":0,"lodging":0,"uuid":"66b27770-544e-40f3-8662-1331e9e1f297","hazard":0,"name":"Cedar Hollow Ditch","stream_order":4,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0}},{"geometry":{"coordinates":[[[-111.83206558227539,40.43153030189339],[-111.83979034423828,40.43074630450917],[-111.84614181518555,40.43153030189339],[-111.86742782592773,40.43166096723547],[-111.87051773071289,40.42943962189105],[-111.87429428100586,40.42943962189105],[-111.87978744506836,40.43153030189339],[-111.884765625,40.43126897044755],[-111.89266204833984,40.43335959357839],[-111.89678192138672,40.435580809437795],[-111.89746856689453,40.436887372726204]],[[-111.89746856689453,40.436887372726204],[-111.90107345581055,40.437540644849236],[-111.90605163574219,40.4357114669092]],[[-111.79344177246094,40.442113371979616],[-111.7965316772461,40.44054561485919],[-111.80700302124023,40.439500423133325],[-111.81129455566406,40.43767129851213],[-111.81524276733398,40.439239122662826],[-111.81232452392578,40.43675671753991],[-111.81386947631836,40.43414356049553],[-111.81455612182617,40.434535540526525],[-111.81644439697266,40.4328369438891],[-111.8162727355957,40.43505817701333],[-111.81953430175781,40.43192229715794],[-111.82056427001953,40.43205296173838],[-111.8217658996582,40.434535540526525],[-111.82107925415039,40.4308769713746],[-111.82210922241211,40.42943962189105],[-111.82313919067383,40.43035430238959],[-111.82846069335938,40.4308769713746]],[[-111.90862655639648,40.43505817701333],[-111.9148063659668,40.437148682337124]],[[-111.9148063659668,40.437148682337124],[-111.91497802734375,40.43740999093242]],[[-111.82846069335938,40.4308769713746],[-111.83206558227539,40.43153030189339]],[[-111.90605163574219,40.4357114669092],[-111.90862655639648,40.43505817701333]]],"type":"MultiLineString"},"id":8460711421726173,"type":"Feature","properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":13888.297335918453,"name":"Bull River Ditch","access":0,"amenities":0,"retail":1,"river_id":"f3234787-673a-4471-9853-1c7e2f990247","flow_site":0,"boat_ramp":0,"lodging":0,"hazard":0,"uuid":"e190dc10-edc4-42cd-a9c5-38cc103a30e2","stream_order":2,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0}},{"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Cutthroat Trout\", \"Green Sunfish\", \"Largemouth Bass\", \"Mountain Whitefish\", \"Northern Pike\", \"Rainbow Trout\", \"Smallmouth Bass\", \"Sockeye Salmon\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":31139.39846516275,"infrastructure":0,"access":0,"amenities":0,"flow_site":0,"boat_ramp":0,"lodging":0,"uuid":"13cc9bfc-8f43-4901-a2f4-8a001310159d","hazard":0,"retail":1,"river_id":"fb97ec5a-349b-4a29-a74e-e0e5560ba1b9","name":"Murdock Canal","stream_order":3,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"miscellaneous":0},"type":"Feature","id":4632961058270519,"geometry":{"coordinates":[[[-111.87395095825195,40.4323142901375],[-111.88665390014648,40.43767129851213],[-111.88854217529297,40.439239122662826],[-111.8902587890625,40.43936977302502],[-111.89128875732422,40.440937557567025],[-111.89420700073242,40.440806910251666],[-111.89420700073242,40.44276659332212],[-111.8960952758789,40.44289723682891],[-111.89695358276367,40.44485685896177]],[[-111.89695358276367,40.44485685896177],[-111.89764022827148,40.44746959960369],[-111.89643859863281,40.448514667422245],[-111.89764022827148,40.44955971899029]],[[-111.86382293701172,40.43179163232364],[-111.87395095825195,40.4323142901375]],[[-111.85592651367188,40.43205296173838],[-111.86382293701172,40.43179163232364]]],"type":"MultiLineString"}},{"id":7916766213314643,"type":"Feature","geometry":{"coordinates":[[[-111.83120727539062,40.37858996679398],[-111.83189392089844,40.37741304199963]],[[-111.83446884155273,40.36708137545483],[-111.83446884155273,40.36276514698761]],[[-111.83343887329102,40.372835916809095],[-111.83515548706055,40.36852005685839],[-111.83446884155273,40.36708137545483]],[[-111.83446884155273,40.36276514698761],[-111.8379020690918,40.361980348481524],[-111.84099197387695,40.35988750779828]],[[-111.83189392089844,40.37741304199963],[-111.83206558227539,40.37466680419533],[-111.83343887329102,40.372835916809095]]],"type":"MultiLineString"},"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":2588.5699181667787,"stream_order":2,"access":0,"amenities":0,"retail":0,"river_id":"b56aaf44-c938-4f31-9c5f-a6705aafa38f","boat_ramp":0,"uuid":"a3b3e741-857c-41ed-8970-d32b06dda678","lodging":0,"hazard":0,"flow_site":0,"name":"Spring Creek","max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0}},{"geometry":{"coordinates":[[-111.79344177246094,40.41075128313747],[-111.79824829101562,40.41245043754495],[-111.80150985717773,40.415456528704595],[-111.8049430847168,40.416632788688474],[-111.80871963500977,40.41937731534847],[-111.81163787841797,40.41976938144623],[-111.81232452392578,40.421206937589574],[-111.82485580444336,40.427871569236146],[-111.82794570922852,40.430484970016664],[-111.83069229125977,40.430484970016664],[-111.83309555053711,40.43153030189339],[-111.83773040771484,40.43113830434379]],"type":"LineString"},"type":"Feature","id":5856837345127169,"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Cutthroat Trout\", \"Green Sunfish\", \"Largemouth Bass\", \"Mountain Whitefish\", \"Northern Pike\", \"Rainbow Trout\", \"Smallmouth Bass\", \"Sockeye Salmon\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":31139.39846516275,"access":0,"amenities":0,"flow_site":0,"boat_ramp":0,"uuid":"7e4b76f2-a2af-4653-a7f5-f7e1630dc3df","lodging":0,"hazard":0,"name":"Murdock Canal","river_id":"fb97ec5a-349b-4a29-a74e-e0e5560ba1b9","retail":1,"stream_order":5,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0}},{"geometry":{"coordinates":[[[-111.83069229125977,40.379113037881154],[-111.83086395263672,40.37898227049007]],[[-111.82914733886719,40.379897636897454],[-111.83069229125977,40.379113037881154]],[[-111.83086395263672,40.37898227049007],[-111.83120727539062,40.37858996679398]]],"type":"MultiLineString"},"type":"Feature","id":646345201085821,"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":7236.204139603133,"access":0,"amenities":0,"flow_site":0,"boat_ramp":0,"lodging":0,"uuid":"b75b80cc-3983-4cc7-9328-acb277a83080","hazard":0,"name":"Cedar Hollow Ditch","retail":0,"river_id":"d7c21197-4f6f-475f-8664-01ec7dfde229","stream_order":2,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0}},{"geometry":{"coordinates":[[-111.84579849243164,40.43179163232364],[-111.85592651367188,40.43205296173838]],"type":"LineString"},"id":5681004055345276,"type":"Feature","properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Cutthroat Trout\", \"Green Sunfish\", \"Largemouth Bass\", \"Mountain Whitefish\", \"Northern Pike\", \"Rainbow Trout\", \"Smallmouth Bass\", \"Sockeye Salmon\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":31139.39846516275,"flow_site":0,"access":0,"amenities":0,"boat_ramp":0,"uuid":"41fc60d0-730f-4bbe-a9b5-6623ae93de57","lodging":0,"hazard":0,"retail":1,"river_id":"fb97ec5a-349b-4a29-a74e-e0e5560ba1b9","name":"Murdock Canal","stream_order":2,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0}},{"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Cutthroat Trout\", \"Green Sunfish\", \"Largemouth Bass\", \"Mountain Whitefish\", \"Northern Pike\", \"Rainbow Trout\", \"Smallmouth Bass\", \"Sockeye Salmon\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":31139.39846516275,"access":0,"amenities":0,"retail":1,"river_id":"fb97ec5a-349b-4a29-a74e-e0e5560ba1b9","flow_site":0,"name":"Murdock Canal","hazard":0,"boat_ramp":0,"lodging":0,"uuid":"8600b81b-b291-4317-a520-dfdc230af182","stream_order":1,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0},"geometry":{"coordinates":[[-111.83773040771484,40.43113830434379],[-111.84579849243164,40.43179163232364]],"type":"LineString"},"id":693787804256335,"type":"Feature"},{"id":409493779101818,"type":"Feature","geometry":{"coordinates":[[-111.83687210083008,40.4185931762984],[-111.8404769897461,40.41715556430296],[-111.84425354003906,40.41428024815738],[-111.85369491577148,40.41323464818589],[-111.8602180480957,40.41650209415022],[-111.86622619628906,40.42251378015388],[-111.873779296875,40.42421263753269],[-111.8818473815918,40.4247353542481]],"type":"LineString"},"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":4563.273148867037,"stream_order":4,"access":0,"amenities":0,"boat_ramp":0,"lodging":0,"uuid":"dbb6d312-a7d9-4922-b151-8229220f2c26","hazard":0,"flow_site":0,"retail":1,"river_id":"72a36fd9-89a0-4575-9779-c50e674a7781","name":"Fox Ditch","max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0}},{"properties":{"min_rapid_class":0,"target_species":"[\"Artic Grayling\", \"Bluegill Sunfish\", \"Brook Trout\", \"Brown Trout\", \"Channel Catfish\", \"Common Carp\", \"Green Sunfish\", \"Largemouth Bass\", \"Northern Pike\", \"Rainbow Trout\", \"Walleye\", \"White Bass\", \"Yellow Perch\", null]","campsite":0,"length":1734.868948205559,"name":"New Survey Ditch","access":0,"amenities":0,"retail":0,"river_id":"7ffabcd8-769f-4a6a-88b4-79277e96db06","flow_site":0,"boat_ramp":0,"lodging":0,"hazard":0,"uuid":"a97be46e-2b00-4449-b976-79ac8be6a842","stream_order":4,"max_rapid_class":0,"water_feature":0,"conservation_site":0,"infrastructure":0,"miscellaneous":0},"id":7669769442321183,"geometry":{"coordinates":[[-111.85111999511719,40.39990182440178],[-111.85283660888672,40.39807162285345],[-111.85832977294922,40.3993789147506],[-111.86502456665039,40.40617642341371]],"type":"LineString"},"type":"Feature"}]


  const pathFinder = new LinestringPathFinder(thing as any as unknown as Feature<MultiLineString | LineString>[], s, e);

  const { path, distance } = pathFinder.findShortestPath(s, e);

  console.log(path, distance);

}

test();