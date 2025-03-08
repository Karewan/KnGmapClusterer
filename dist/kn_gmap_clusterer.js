/**
 * KnGmapClusterer v4.0.2 (2025-03-08 19:55:46 +0100)
 * Copyright (c) 2021 - 2025 Florent VIALATTE
 * Released under the MIT license
 */
'use strict';

/**
 * KnGmapClusterer class constructor
 * @param map
 * @param opt
 * @returns KnGmapClusterer
 */
const KnGmapClusterer = function (map, opt) {
	console.log('KnGmapClusterer()');

	const mThis = this;

	/************************************************************
	 * github.com/mourner/kdbush v4.0.2
	 ***********************************************************/

	const ARRAY_TYPES = [
		Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
		Int32Array, Uint32Array, Float32Array, Float64Array
	],
		VERSION = 1, // serialized format version
		HEADER_SIZE = 8;

	class KDBush {
		/**
		 * Creates an index that will hold a given number of items.
		 * @param {number} numItems
		 * @param {number} [nodeSize=64] Size of the KD-tree node (64 by default).
		 * @param {TypedArrayConstructor} [ArrayType=Float64Array] The array type used for coordinates storage (`Float64Array` by default).
		 * @param {ArrayBuffer} [data] (For internal use only)
		 */
		constructor(numItems, nodeSize = 64, ArrayType = Float64Array, data) {
			if (isNaN(numItems) || numItems < 0) throw new Error(`Unexpected numItems value: ${numItems}.`);

			this.numItems = +numItems;
			this.nodeSize = Math.min(Math.max(+nodeSize, 2), 65535);
			this.ArrayType = ArrayType;
			this.IndexArrayType = numItems < 65536 ? Uint16Array : Uint32Array;

			const arrayTypeIndex = ARRAY_TYPES.indexOf(this.ArrayType);
			const coordsByteSize = numItems * 2 * this.ArrayType.BYTES_PER_ELEMENT;
			const idsByteSize = numItems * this.IndexArrayType.BYTES_PER_ELEMENT;
			const padCoords = (8 - idsByteSize % 8) % 8;

			if (arrayTypeIndex < 0) {
				throw new Error(`Unexpected typed array class: ${ArrayType}.`);
			}

			if (data && (data instanceof ArrayBuffer)) { // reconstruct an index from a buffer
				this.data = data;
				this.ids = new this.IndexArrayType(this.data, HEADER_SIZE, numItems);
				this.coords = new this.ArrayType(this.data, HEADER_SIZE + idsByteSize + padCoords, numItems * 2);
				this._pos = numItems * 2;
				this._finished = true;
			} else { // initialize a new index
				this.data = new ArrayBuffer(HEADER_SIZE + coordsByteSize + idsByteSize + padCoords);
				this.ids = new this.IndexArrayType(this.data, HEADER_SIZE, numItems);
				this.coords = new this.ArrayType(this.data, HEADER_SIZE + idsByteSize + padCoords, numItems * 2);
				this._pos = 0;
				this._finished = false;

				// set header
				new Uint8Array(this.data, 0, 2).set([0xdb, (VERSION << 4) + arrayTypeIndex]);
				new Uint16Array(this.data, 2, 1)[0] = nodeSize;
				new Uint32Array(this.data, 4, 1)[0] = numItems;
			}
		}

		/**
		 * Add a point to the index.
		 * @param {number} x
		 * @param {number} y
		 * @returns {number} An incremental index associated with the added item (starting from `0`).
		 */
		add(x, y) {
			const index = this._pos >> 1;
			this.ids[index] = index;
			this.coords[this._pos++] = x;
			this.coords[this._pos++] = y;
			return index;
		}

		/**
		 * Perform indexing of the added points.
		 */
		finish() {
			const numAdded = this._pos >> 1;
			if (numAdded !== this.numItems) {
				throw new Error(`Added ${numAdded} items when expected ${this.numItems}.`);
			}
			// kd-sort both arrays for efficient search
			sort(this.ids, this.coords, this.nodeSize, 0, this.numItems - 1, 0);

			this._finished = true;
			return this;
		}

		/**
		 * Search the index for items within a given bounding box.
		 * @param {number} minX
		 * @param {number} minY
		 * @param {number} maxX
		 * @param {number} maxY
		 * @returns {number[]} An array of indices correponding to the found items.
		 */
		range(minX, minY, maxX, maxY) {
			if (!this._finished) throw new Error('Data not yet indexed - call index.finish().');

			const { ids, coords, nodeSize } = this;
			const stack = [0, ids.length - 1, 0];
			const result = [];

			// recursively search for items in range in the kd-sorted arrays
			while (stack.length) {
				const axis = stack.pop() || 0;
				const right = stack.pop() || 0;
				const left = stack.pop() || 0;

				// if we reached "tree node", search linearly
				if (right - left <= nodeSize) {
					for (let i = left; i <= right; i++) {
						const x = coords[2 * i];
						const y = coords[2 * i + 1];
						if (x >= minX && x <= maxX && y >= minY && y <= maxY) result.push(ids[i]);
					}
					continue;
				}

				// otherwise find the middle index
				const m = (left + right) >> 1;

				// include the middle item if it's in range
				const x = coords[2 * m];
				const y = coords[2 * m + 1];
				if (x >= minX && x <= maxX && y >= minY && y <= maxY) result.push(ids[m]);

				// queue search in halves that intersect the query
				if (axis === 0 ? minX <= x : minY <= y) {
					stack.push(left);
					stack.push(m - 1);
					stack.push(1 - axis);
				}
				if (axis === 0 ? maxX >= x : maxY >= y) {
					stack.push(m + 1);
					stack.push(right);
					stack.push(1 - axis);
				}
			}

			return result;
		}

		/**
		 * Search the index for items within a given radius.
		 * @param {number} qx
		 * @param {number} qy
		 * @param {number} r Query radius.
		 * @returns {number[]} An array of indices correponding to the found items.
		 */
		within(qx, qy, r) {
			if (!this._finished) throw new Error('Data not yet indexed - call index.finish().');

			const { ids, coords, nodeSize } = this;
			const stack = [0, ids.length - 1, 0];
			const result = [];
			const r2 = r * r;

			// recursively search for items within radius in the kd-sorted arrays
			while (stack.length) {
				const axis = stack.pop() || 0;
				const right = stack.pop() || 0;
				const left = stack.pop() || 0;

				// if we reached "tree node", search linearly
				if (right - left <= nodeSize) {
					for (let i = left; i <= right; i++) {
						if (sqDist(coords[2 * i], coords[2 * i + 1], qx, qy) <= r2) result.push(ids[i]);
					}
					continue;
				}

				// otherwise find the middle index
				const m = (left + right) >> 1;

				// include the middle item if it's in range
				const x = coords[2 * m];
				const y = coords[2 * m + 1];
				if (sqDist(x, y, qx, qy) <= r2) result.push(ids[m]);

				// queue search in halves that intersect the query
				if (axis === 0 ? qx - r <= x : qy - r <= y) {
					stack.push(left);
					stack.push(m - 1);
					stack.push(1 - axis);
				}
				if (axis === 0 ? qx + r >= x : qy + r >= y) {
					stack.push(m + 1);
					stack.push(right);
					stack.push(1 - axis);
				}
			}

			return result;
		}
	}

	/**
	 * @param {Uint16Array | Uint32Array} ids
	 * @param {InstanceType<TypedArrayConstructor>} coords
	 * @param {number} nodeSize
	 * @param {number} left
	 * @param {number} right
	 * @param {number} axis
	 */
	function sort(ids, coords, nodeSize, left, right, axis) {
		if (right - left <= nodeSize) return;

		const m = (left + right) >> 1; // middle index

		// sort ids and coords around the middle index so that the halves lie
		// either left/right or top/bottom correspondingly (taking turns)
		select(ids, coords, m, left, right, axis);

		// recursively kd-sort first half and second half on the opposite axis
		sort(ids, coords, nodeSize, left, m - 1, 1 - axis);
		sort(ids, coords, nodeSize, m + 1, right, 1 - axis);
	}

	/**
	 * Custom Floyd-Rivest selection algorithm: sort ids and coords so that
	 * [left..k-1] items are smaller than k-th item (on either x or y axis)
	 * @param {Uint16Array | Uint32Array} ids
	 * @param {InstanceType<TypedArrayConstructor>} coords
	 * @param {number} k
	 * @param {number} left
	 * @param {number} right
	 * @param {number} axis
	 */
	function select(ids, coords, k, left, right, axis) {

		while (right > left) {
			if (right - left > 600) {
				const n = right - left + 1;
				const m = k - left + 1;
				const z = Math.log(n);
				const s = 0.5 * Math.exp(2 * z / 3);
				const sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
				const newLeft = Math.max(left, Math.floor(k - m * s / n + sd));
				const newRight = Math.min(right, Math.floor(k + (n - m) * s / n + sd));
				select(ids, coords, k, newLeft, newRight, axis);
			}

			const t = coords[2 * k + axis];
			let i = left;
			let j = right;

			swapItem(ids, coords, left, k);
			if (coords[2 * right + axis] > t) swapItem(ids, coords, left, right);

			while (i < j) {
				swapItem(ids, coords, i, j);
				i++;
				j--;
				while (coords[2 * i + axis] < t) i++;
				while (coords[2 * j + axis] > t) j--;
			}

			if (coords[2 * left + axis] === t) swapItem(ids, coords, left, j);
			else {
				j++;
				swapItem(ids, coords, j, right);
			}

			if (j <= k) left = j + 1;
			if (k <= j) right = j - 1;
		}
	}

	/**
	 * @param {Uint16Array | Uint32Array} ids
	 * @param {InstanceType<TypedArrayConstructor>} coords
	 * @param {number} i
	 * @param {number} j
	 */
	function swapItem(ids, coords, i, j) {
		swap(ids, i, j);
		swap(coords, 2 * i, 2 * j);
		swap(coords, 2 * i + 1, 2 * j + 1);
	}

	/**
	 * @param {InstanceType<TypedArrayConstructor>} arr
	 * @param {number} i
	 * @param {number} j
	 */
	function swap(arr, i, j) {
		const tmp = arr[i];
		arr[i] = arr[j];
		arr[j] = tmp;
	}

	/**
	 * @param {number} ax
	 * @param {number} ay
	 * @param {number} bx
	 * @param {number} by
	 */
	function sqDist(ax, ay, bx, by) {
		const dx = ax - bx;
		const dy = ay - by;
		return dx * dx + dy * dy;
	}

	/************************************************************
	 * Custom version of github.com/mapbox/supercluster v8.0.1
	 ***********************************************************/

	class kCluster {
		constructor() {
			this.trees = new Array(GV.opt.maxZoom + 1);
		}

		load(points) {
			this.points = points;

			let clusters = [];
			points.forEach((p, i) => clusters.push(createPointCluster(p, i)));
			this.trees[GV.opt.maxZoom + 1] = this._createTree(clusters);

			for (let z = GV.opt.maxZoom; z >= GV.opt.minZoom; z--) {
				clusters = this._cluster(clusters, z);
				this.trees[z] = this._createTree(clusters);
			}

			return this;
		}

		getClusters(bbox, zoom) {
			let minLng = ((bbox[0] + 180) % 360 + 360) % 360 - 180,
				maxLng = bbox[2] === 180 ? 180 : ((bbox[2] + 180) % 360 + 360) % 360 - 180;

			const minLat = Math.max(-90, Math.min(90, bbox[1])),
				maxLat = Math.max(-90, Math.min(90, bbox[3]));

			if (bbox[2] - bbox[0] >= 360) {
				minLng = -180;
				maxLng = 180;
			} else if (minLng > maxLng) {
				const easternHem = this.getClusters([minLng, minLat, 180, maxLat], zoom),
					westernHem = this.getClusters([-180, minLat, maxLng, maxLat], zoom);

				return easternHem.concat(westernHem);
			}

			const tree = this.trees[this._limitZoom(zoom)],
				clusters = [];

			tree.range(lngX(minLng), latY(maxLat), lngX(maxLng), latY(minLat)).forEach(id => {
				const c = tree.data[id];
				clusters.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
			});

			return clusters;
		}

		getChildren(clusterId) {
			const originId = this._getOriginId(clusterId),
				originZoom = this._getOriginZoom(clusterId),
				errorMsg = 'No cluster with the specified id.';

			const index = this.trees[originZoom];
			if (!index) throw new Error(errorMsg);

			const origin = index.data[originId];
			if (!origin) throw new Error(errorMsg);

			const r = GV.opt.radius / (GV.opt.extent * Math.pow(2, originZoom - 1)),
				children = [];

			index.within(origin.x, origin.y, r).forEach(id => {
				const c = index.data[id];
				if (c.parentId === clusterId) children.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
			});

			if (children.length === 0) throw new Error(errorMsg);

			return children;
		}

		getClusterExpansionZoom(clusterId) {
			let expansionZoom = this._getOriginZoom(clusterId) - 1;

			while (expansionZoom <= GV.opt.maxZoom) {
				const children = this.getChildren(clusterId);
				expansionZoom++;
				if (children.length !== 1) break;
				clusterId = children[0].cluster_id;
			}

			return expansionZoom;
		}

		_createTree(data) {
			const tree = new KDBush(data.length, GV.opt.nodeSize, Float32Array);
			data.forEach(d => tree.add(d.x, d.y));
			tree.finish();
			tree.data = data;
			return tree;
		}

		_limitZoom(z) {
			return Math.max(GV.opt.minZoom, Math.min(Math.floor(+z), GV.opt.maxZoom + 1));
		}

		_cluster(points, zoom) {
			const r = GV.opt.radius / (GV.opt.extent * Math.pow(2, zoom)),
				clusters = [];

			points.forEach((p, i) => {
				if (p.zoom <= zoom) return;
				p.zoom = zoom;

				const tree = this.trees[zoom + 1],
					neighborIds = tree.within(p.x, p.y, r),
					numPointsOrigin = p.numPoints || 1;

				let numPoints = numPointsOrigin;

				neighborIds.forEach(neighborId => {
					const b = tree.data[neighborId];
					if (b.zoom > zoom) numPoints += b.numPoints || 1;
				});

				if (numPoints > numPointsOrigin && numPoints >= GV.opt.minPoints) {
					let wx = p.x * numPointsOrigin,
						wy = p.y * numPointsOrigin;

					const id = (i << 5) + (zoom + 1) + this.points.length;

					neighborIds.forEach(neighborId => {
						const b = tree.data[neighborId];

						if (b.zoom <= zoom) return;
						b.zoom = zoom;

						const numPoints2 = b.numPoints || 1;
						wx += b.x * numPoints2;
						wy += b.y * numPoints2;

						b.parentId = id;
					});

					p.parentId = id;
					clusters.push(createCluster(wx / numPoints, wy / numPoints, id, numPoints));
				} else {
					clusters.push(p);

					if (numPoints > 1) {
						neighborIds.forEach(neighborId => {
							const b = tree.data[neighborId];
							if (b.zoom <= zoom) return;
							b.zoom = zoom;
							clusters.push(b);
						});
					}
				}
			});

			return clusters;
		}

		_getOriginId(clusterId) {
			return (clusterId - this.points.length) >> 5;
		}

		_getOriginZoom(clusterId) {
			return (clusterId - this.points.length) % 32;
		}
	}

	function createCluster(x, y, id, numPoints) {
		return {
			x: Math.fround(x),
			y: Math.fround(y),
			zoom: Infinity,
			id,
			parentId: -1,
			numPoints
		};
	}

	function createPointCluster(p, id) {
		return {
			x: Math.fround(lngX(p.x)),
			y: Math.fround(latY(p.y)),
			zoom: Infinity,
			index: id,
			parentId: -1
		};
	}

	function getClusterJSON(cluster) {
		const count = cluster.numPoints,
			abbrev = count >= 10000 ? `${Math.round(count / 1000)}k` : (count >= 1000 ? `${Math.round(count / 100) / 10}k` : count);

		return {
			x: xLng(cluster.x),
			y: yLat(cluster.y),
			cluster_id: cluster.id,
			nb_points: count,
			nb_points_abbr: abbrev
		};
	}

	function lngX(lng) {
		return lng / 360 + 0.5;
	}

	function latY(lat) {
		const sin = Math.sin(lat * Math.PI / 180),
			y = (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);

		return y < 0 ? 0 : y > 1 ? 1 : y;
	}

	function xLng(x) {
		return (x - 0.5) * 360;
	}

	function yLat(y) {
		const y2 = (180 - y * 360) * Math.PI / 180;

		return 360 * Math.atan(Math.exp(y2)) / Math.PI - 90;
	}

	/*************************************************
	 * PRIVATE
	 ************************************************/

	// Global vars
	const GV = {};
	GV.map = map;
	GV.opt = Object.assign({
		minZoom: 0, // min zoom to generate clusters on
		maxZoom: 17, // max zoom level to cluster the points on
		minPoints: 2, // minimum points to form a cluster
		radius: 256, // cluster radius in pixels
		extent: 512, // tile extent (radius is calculated relative to it)
		nodeSize: 64, // size of the KD-tree leaf node, affects performance
		mergeDuplicates: false,
		clickToZoom: true,
		clusterIcon: null,
		clusterFontColor: '#000',
		clusterFontSize: '12px',
		clusterFontFamily: 'sans-serif',
		clusterFontWeight: 'normal',
		markerFontColor: '#000',
		markerFontSize: '12px',
		markerFontFamily: 'sans-serif',
		markerFontWeight: 'normal',
		markerIcon: null,
		onMarkerClick: null
	}, opt || {});
	GV.markers = new Map();
	GV.kcluster = new kCluster();

	/**
	 * add idle listener
	 */
	function addIdleListener() {
		console.log('KnGmapClusterer.addIdleListener()');

		GV.idle_listener = GV.map.addListener('idle', onMapIdle);
	}

	/**
	 * on map idle
	 */
	function onMapIdle() {
		console.log('KnGmapClusterer.onMapIdle()');

		// Draw the clusters
		drawClusters(GV.map.getBounds(), GV.map.getZoom());
	}

	/**
	 * remove idle listener
	 */
	function removeIdleListener() {
		console.log('KnGmapClusterer.removeIdleListener()');

		if (!GV.idle_listener) return;

		GV.idle_listener.remove();
		GV.idle_listener = null;
	}

	/**
	 * draw clusters
	 * @param bounds
	 * @param zoom
	 */
	function drawClusters(bounds, zoom) {
		console.log('KnGmapClusterer.drawClusters()', bounds, zoom);

		const old_markers = new Map(GV.markers);
		GV.markers.clear();

		GV.kcluster.getClusters([bounds.getSouthWest().lng(), bounds.getSouthWest().lat(), bounds.getNorthEast().lng(), bounds.getNorthEast().lat()], zoom).forEach(c => {
			console.log("KnGmapClusterer.drawClusters()", c);

			if (c.cluster_id) {
				if (old_markers.has('c' + c.cluster_id)) {
					console.log('KnGmapClusterer.drawClusters() cluster already on map');
					GV.markers.set('c' + c.cluster_id, old_markers.get('c' + c.cluster_id));
					old_markers.delete('c' + c.cluster_id);
					return;
				}

				addClusterToMap(c);
			} else {
				if (old_markers.has('m' + c.id)) {
					console.log('KnGmapClusterer.drawClusters() marker already on map');
					GV.markers.set('m' + c.id, old_markers.get('m' + c.id));
					old_markers.delete('m' + c.id);
					return;
				}

				addMarkerToMap(c);
			}
		});

		old_markers.forEach(m => removeMarkerFromMap(m));
	}

	/**
	 * add cluster to map
	 * @param c
	 */
	function addClusterToMap(c) {
		console.log('KnGmapClusterer.addClusterToMap()', c);

		const marker = new google.maps.Marker({
			kData: c,
			map: GV.map,
			icon: (typeof GV.opt.clusterIcon == 'function' ? GV.opt.clusterIcon(c) : GV.opt.clusterIcon) || null,
			zIndex: Number(google.maps.Marker.MAX_ZINDEX) + c.nb_points,
			position: { lat: c.y, lng: c.x },
			label: {
				text: String(c.nb_points_abbr),
				color: GV.opt.clusterFontColor,
				fontSize: GV.opt.clusterFontSize,
				fontWeight: GV.opt.clusterFontWeight,
				fontFamily: GV.opt.clusterFontFamily
			}
		});

		if (GV.opt.clickToZoom) marker.k_click_listener = marker.addListener('click', onClusterClick);

		GV.markers.set('c' + c.cluster_id, marker);
	}

	/**
	 * on cluster click
	 * @param e
	 */
	function onClusterClick(e) {
		console.log('KnGmapClusterer.onClusterClick()', e);

		e.stop();

		GV.map.setOptions({
			zoom: GV.kcluster.getClusterExpansionZoom(this.kData.cluster_id),
			center: this.getPosition()
		});
	}

	/**
	 * add marker to map
	 * @param m
	 */
	function addMarkerToMap(m) {
		console.log('KnGmapClusterer.addMarkerToMap()', m);

		const positon = new google.maps.LatLng(m.y, m.x);

		if (GV.opt.mergeDuplicates) {
			for (const am of GV.markers) {
				if (am[1].is_dup || !am[1].position.equals(positon)) continue;
				console.log("KnGmapClusterer.addMarkerToMap() duplicate", m.id);

				if (!am[1].duplicates) am[1].duplicates = [];
				am[1].duplicates.push(m.id);

				GV.markers.set('m' + m.id, { is_dup: 1, setMap: () => 1 });
				return;
			}

			console.log("KnGmapClusterer.addMarkerToMap() not a duplicate", m.id);
		}

		const marker = new google.maps.Marker({
			kData: m,
			map: GV.map,
			icon: (typeof GV.opt.markerIcon == 'function' ? GV.opt.markerIcon(m) : GV.opt.markerIcon) || null,
			position: positon
		});

		if (m.label !== undefined) marker.setLabel({
			text: String(m.label),
			color: GV.opt.markerFontColor,
			fontSize: GV.opt.markerFontSize,
			fontWeight: GV.opt.markerFontWeight,
			fontFamily: GV.opt.markerFontFamily
		});

		if (GV.opt.onMarkerClick) marker.k_click_listener = marker.addListener('click', GV.opt.onMarkerClick);

		GV.markers.set('m' + m.id, marker);
	}

	/**
	 * remove marker from map
	 * @param m
	 */
	function removeMarkerFromMap(m) {
		console.log('KnGmapClusterer.removeMarkerFromMap()', m);

		if (m.k_click_listener) m.k_click_listener.remove();
		m.setMap(null);
	}

	/*************************************************
	 * PUBLIC
	 ************************************************/

	/**
	 * set options
	 * @param opt
	 */
	this.setOptions = function (opt) {
		console.log('KnGmapClusterer.setOptions()', opt);

		GV.opt = Object.assign(GV.opt || {}, opt || {});
	}

	/**
	 * load points
	 * @param points
	 * @param autoCenterZoom
	 */
	this.load = function (points, autoCenterZoom = true) {
		console.log('KnGmapClusterer.load()');

		// Clear markers
		mThis.clearMarkers();

		// Min one point
		if (points.length > 0) {
			// Markers bounds
			const bounds = new google.maps.LatLngBounds();
			points.forEach(p => bounds.extend({ lat: p.y, lng: p.x }));

			// Fit map to bounds
			if (autoCenterZoom) {
				GV.map.setOptions({
					zoom: mThis.getBoundsZoomLevel(bounds),
					center: bounds.getCenter()
				});
			} else {
				onMapIdle();
			}

			// Load points into supercluster
			GV.kcluster.load(points);
		}

		// Add the idle listener => drawClusters
		addIdleListener();
	}

	/**
	 * get markers
	 * @return array
	 */
	this.getMarkers = function () {
		console.log('KnGmapClusterer.getMarkers()');

		return GV.markers;
	}

	/**
	 * clear markers
	 */
	this.clearMarkers = function () {
		console.log('KnGmapClusterer.clearMarkers()');

		removeIdleListener();
		GV.markers.forEach(m => removeMarkerFromMap(m));
		GV.markers.clear();
	}

	/**
	 * get bounds zoom level
	 * @param bounds
	 * @return int
	 */
	this.getBoundsZoomLevel = function (bounds) {
		function _latRad(lat) {
			const sin = Math.sin(lat * Math.PI / 180),
				rad_x2 = Math.log((1 + sin) / (1 - sin)) / 2;

			return Math.max(Math.min(rad_x2, Math.PI), -Math.PI) / 2;
		}

		function _zoom(map_px, world_px, fraction) {
			return Math.floor(Math.log(map_px / world_px / fraction) / Math.LN2);
		}

		const ne = bounds.getNorthEast(),
			sw = bounds.getSouthWest(),
			lat_fraction = (_latRad(ne.lat()) - _latRad(sw.lat())) / Math.PI,
			lng_diff = ne.lng() - sw.lng(),
			lng_fraction = ((lng_diff < 0) ? (lng_diff + 360) : lng_diff) / 360;

		return Math.min(
			_zoom(GV.map.getDiv().offsetHeight, 256, lat_fraction),
			_zoom(GV.map.getDiv().offsetWidth, 256, lng_fraction),
			17
		);
	}
};

KnGmapClusterer.VERSION = '4.0.2';
