import LinestringPathFinder from './turf-path';
import { Feature, LineString, MultiLineString, lineString } from '@turf/helpers';

// Load the example data
const exampleData = require('./example-path.json');

/**
 * Generates a feature collection for visualization with:
 * - The found path (neon green)
 * - Network linestrings (neon red)
 * - Start point (green)
 * - End point (orange)
 */
function generateFeatureCollection(
  pathFinder: LinestringPathFinder,
  start: number[], 
  end: number[], 
  result: any
) {
  const features: any[] = [];

  // Add the path (neon green)
  if (result.success) {
    features.push({
      type: 'Feature',
      properties: {
        color: '#00ff66',
        stroke: '#00ff66',
        'stroke-width': 3,
        'stroke-opacity': 0.8,
        description: 'Found path'
      },
      geometry: result.path.geometry
    });
  }

  // Add network linestrings (neon red)
  pathFinder.linestrings.forEach((linestring: any, index: number) => {
    features.push({
      type: 'Feature',
      properties: {
        color: '#ff0066',
        stroke: '#ff0066',
        'stroke-width': 1,
        'stroke-opacity': 0.6,
        description: `Network linestring ${index + 1}`
      },
      geometry: linestring.geometry
    });
  });

  // Add start point (green)
  features.push({
    type: 'Feature',
    properties: {
      color: '#00ff00',
      'marker-color': '#00ff00',
      'marker-size': 'medium',
      description: 'Start point'
    },
    geometry: {
      type: 'Point',
      coordinates: start
    }
  });

  // Add end point (orange)
  features.push({
    type: 'Feature',
    properties: {
      color: '#ff6600',
      'marker-color': '#ff6600',
      'marker-size': 'medium',
      description: 'End point'
    },
    geometry: {
      type: 'Point',
      coordinates: end
    }
  });

  return {
    type: 'FeatureCollection',
    features: features
  };
}

async function testPathFinder() {
  console.log('🚀 Testing LinestringPathFinder...\n');
  
  const { start, end, features } = exampleData;
  
  console.log('📍 Start point:', start);
  console.log('📍 End point:', end);
  console.log('🛤️  Number of river features:', features.length);
  
  // Convert features to proper GeoJSON format
  const riverFeatures: Feature<LineString | MultiLineString>[] = features.map((feature: any) => ({
    type: 'Feature',
    properties: feature.properties || {},
    geometry: feature.geometry
  }));
  
  console.log('\n⏱️  Creating path finder...');
  const pathFinder = new LinestringPathFinder(riverFeatures, start, end);
  
  console.log('🔍 Finding shortest path...');
  const result = pathFinder.findShortestPath(start, end);
  
  // Generate and log the feature collection for visualization AFTER pathfinding
  console.log('\n🗺️  Generating feature collection for visualization...');
  const featureCollection = generateFeatureCollection(pathFinder, start, end, result);
  console.log('📋 Feature Collection:');
  console.log(JSON.stringify(featureCollection));
  
  console.log('\n📊 Results:');
  console.log('✅ Success:', result.success);
  console.log('📏 Distance:', result.distance, 'miles');
  
  if (result.success) {
    console.log('🛤️  Path coordinates:', result.path.geometry.coordinates.length, 'points');
    console.log('📍 First point:', result.path.geometry.coordinates[0]);
    console.log('📍 Last point:', result.path.geometry.coordinates[result.path.geometry.coordinates.length - 1]);
  } else {
    console.log('❌ Error:', result.error);
  }
  
  // Test some additional functionality
  console.log('\n🧪 Additional tests:');
  console.log('⏰ Timed out:', pathFinder.isTimedOut());
  console.log('🌊 Too far from rivers:', pathFinder.isTooFarFromRivers);
  console.log('🌐 Network size:', pathFinder.network.size, 'nodes');
  console.log('🛤️  Number of network linestrings:', pathFinder.linestrings.length);
  
  return result;
}

// Run the test
testPathFinder()
  .then((result) => {
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }); 