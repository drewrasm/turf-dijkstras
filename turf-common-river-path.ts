import {
  Feature,
  FeatureCollection,
  LineString,
  lineString,
  MultiLineString,
  point,
} from '@turf/helpers';
import nearestPointOnLine from '@turf/nearest-point-on-line';

import {start, end, commonRiver} from './example-path-with-same-river.json'
import lineSlice from '@turf/line-slice';


const coordinatesEqual = (coord1: number[], coord2: number[]): boolean => {
    return coord1[0] === coord2[0] && coord1[1] === coord2[1];
  }
  
  const connectMultiLineSegments = (multiLine: Feature<MultiLineString>): Feature<LineString> => {
    if (multiLine.geometry.type !== 'MultiLineString') {
      throw new Error('Input must be a MultiLineString');
    }
    
    const segments = [...multiLine.geometry.coordinates];
    
    if (segments.length === 0) {
      return lineString([]);
    }
    
    // Start with the first segment
    let connectedCoords = [...segments[0]];
    segments.splice(0, 1);
    
    let foundConnection = true;
    
    // Keep looking for connections as long as we find them
    while (foundConnection && segments.length > 0) {
      foundConnection = false;
      
      // Check all remaining segments
      for (let i = 0; i < segments.length; i++) {
        const currentSegment = segments[i];
        const firstPointOfSegment = currentSegment[0];
        const lastPointOfSegment = currentSegment[currentSegment.length - 1];
        
        const startPoint = connectedCoords[0];
        const endPoint = connectedCoords[connectedCoords.length - 1];
        
        // Case 1: Current segment's last point connects to our start
        if (coordinatesEqual(lastPointOfSegment, startPoint)) {
          // Add all except last point to the beginning
          connectedCoords = [...currentSegment.slice(0, -1), ...connectedCoords];
          segments.splice(i, 1);
          foundConnection = true;
          break;
        }
        
        // Case 2: Current segment's first point connects to our end
        else if (coordinatesEqual(firstPointOfSegment, endPoint)) {
          // Add all except first point to the end
          connectedCoords = [...connectedCoords, ...currentSegment.slice(1)];
          segments.splice(i, 1);
          foundConnection = true;
          break;
        }
        
        // Case 3: Current segment needs to be reversed - its first point connects to our start
        else if (coordinatesEqual(firstPointOfSegment, startPoint)) {
          // Reverse it and add all except last point to the beginning
          const reversed = [...currentSegment].reverse();
          connectedCoords = [...reversed.slice(0, -1), ...connectedCoords];
          segments.splice(i, 1);
          foundConnection = true;
          break;
        }
        
        // Case 4: Current segment needs to be reversed - its last point connects to our end
        else if (coordinatesEqual(lastPointOfSegment, endPoint)) {
          // Reverse it and add all except first point to the end
          const reversed = [...currentSegment].reverse();
          connectedCoords = [...connectedCoords, ...reversed.slice(1)];
          segments.splice(i, 1);
          foundConnection = true;
          break;
        }
      }
    }
    
    return lineString(connectedCoords);
  }
  
  
  const commonRiverPath = (start: number[], end: number[], river: Feature<MultiLineString>): Feature<LineString> => {
    
    const line = connectMultiLineSegments(river)
    
    const slice = lineSlice(start, end, line)
    const nearestPointForStart = nearestPointOnLine(slice, point(start))
    const nearestPointForEnd = nearestPointOnLine(slice, point(end))
  
    const path = lineString([
      start,
      nearestPointForStart.geometry.coordinates,
      ...slice.geometry.coordinates.slice(1, -1),
      nearestPointForEnd.geometry.coordinates,
      end
    ])
  
    return path
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


  const path = commonRiverPath(start, end, commonRiver as Feature<MultiLineString>)
  console.log(JSON.stringify(highlightPathAndPoints([connectMultiLineSegments(commonRiver as Feature<MultiLineString>)], path, start, end)))