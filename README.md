# KnGmapClusterer

Javascript marker clusterer library for Google Map, the fastest in the world without server side processing (at the time).

### Changelog

See the changelog [here](CHANGELOG.md)

### Usage

* Get the latest version in [dist](dist) folder

* Methods

	```javascript
	// Create an instance
	let instance = new KnGmapClusterer(gmapInstance, opt);

	// Load data array
	// (each object must have x and y properties at least)
	// (custom properties allowed)
	instance.load(points);

	// Return all markers
	instance.getMarkers();

	// Clear all markers from the map (and the clusters)
	instance.clearMarkers();

	// Overwrite instance option
	instance.setOptions(opt);

	// Get zoom level for bounds
	instance.getBoundsZoomLevel(bounds);
	```

* Properties

	```javascript
	// Return the lib version
	KnGmapClusterer.VERSION;
	```

* Options

	```javascript
	let instance = new KnGmapClusterer(gmapInstance, {
		// min zoom to generate clusters on
		minZoom = 0,
		// max zoom level to cluster the points on
		maxZoom = 17,
		// minimum points to form a cluster
		minPoints = 2,
		// cluster radius in pixels
		radius = 256,
		// tile extent (radius is calculated relative to it)
		extent = 512,
		// size of the KD-tree leaf node, affects performance
		nodeSize = 64,
		// Merge duplicate marker into one on the map (marker objet contains all duplicates)
		mergeDuplicates = false,
		// Click to zoom on cluster
		clickToZoom = true,
		// Cluster icon (Google icons options, can be a callable)
		clusterIcon = {
			url: 'img/gmap/c-black.svg',
			size: new google.maps.Size(45,45),
			scaledSize: new google.maps.Size(43,43),
			anchor: new google.maps.Point(21.5,21.5),
			origin: new google.maps.Point(0,0),
			labelOrigin: new google.maps.Point(21.5,21.5)
		},
		// Cluster font color
		clusterFontColor = '#000',
		// Cluster font size
		clusterFontSize = '12px',
		// Cluster font family
		clusterFontFamily = 'sans-serif',
		// Cluster font weight
		clusterFontWeight = 'normal',
		// Marker font color
		markerFontColor = '#000',
		// Marker font size
		markerFontSize = '12px',
		// Marker font family
		markerFontFamily = 'sans-serif',
		// Marker font weight
		markerFontWeight = 'normal',
		// Marker icon (Google icons options, can be a callable)
		markerIcon = {
			url: 'img/gmap/m-blue.svg',
			size: new google.maps.Size(32.5,46),
			scaledSize: new google.maps.Size(30,43.13),
			anchor: new google.maps.Point(15,43.13),
			origin: new google.maps.Point(0,0)
		},
		// Marker click callback (Standard Google callback)
		onMarkerClick = (e) => {}
	});
	```

### License

See the license [here](LICENSE.txt)

```
The MIT License (MIT)

Copyright (c) 2021 - 2024 Florent VIALATTE

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
