import {
  Feature,
  FeatureCollection,
  LineString,
  lineString,
  point,
} from '@turf/helpers';
import nearestPointOnLine from '@turf/nearest-point-on-line';

import {start, end, commonRiver} from './salmon-river-geojson.json'
import lineSlice from '@turf/line-slice';
import turfDistance from '@turf/distance';


  
  const commonRiverPath = (start: number[], end: number[], river: Feature<LineString>): Feature<LineString> => {
    const slice = lineSlice(start, end, river)
    // const nearestPointForStart = nearestPointOnLine(slice, point(start))
    // const nearestPointForEnd = nearestPointOnLine(slice, point(end))

    if(turfDistance(end, slice.geometry.coordinates[0]) > turfDistance(start, slice.geometry.coordinates[0])) { 
      return lineString([
        start,
        // nearestPointForStart.geometry.coordinates,
        ...slice.geometry.coordinates.slice(1, -1),
        // nearestPointForEnd.geometry.coordinates,
        end
      ])  
    } else {
      return lineString([
        end,
        // nearestPointForEnd.geometry.coordinates,
        ...slice.geometry.coordinates.slice(1, -1),
        // nearestPointForStart.geometry.coordinates,
        start
      ])
    }  
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
  const path = commonRiverPath(start, end, commonRiver as Feature<LineString>)

  console.log(JSON.stringify(highlightPathAndPoints([commonRiver as Feature<LineString>], path, start, end)))
  console.log(`Time taken: ${Date.now() - startTime}ms`);