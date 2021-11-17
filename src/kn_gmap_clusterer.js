'use strict';

const KnGmapClusterer = function() {
	const VERSION = '2.0.6',
	GV = {};

	/**
	 * init KnGmapClusterer
	 * @param map
	 * @param opt
	 */
	function init(map, opt) {
		console.log('KnGmapClusterer.init()');

		if(!opt) opt = {};
		if(!opt.minZoom) opt.minZoom = 0; // min zoom to generate clusters on
		if(!opt.maxZoom) opt.maxZoom = 17; // max zoom level to cluster the points on
		if(!opt.minPoints) opt.minPoints = 2; // minimum points to form a cluster
		if(!opt.radius) opt.radius = 256; // cluster radius in pixels
		if(!opt.extent) opt.extent = 512; // tile extent (radius is calculated relative to it)
		if(!opt.nodeSize) opt.nodeSize = 64; // size of the KD-tree leaf node, affects performance
		if(!opt.clickToZoom) opt.clickToZoom = true;
		if(!opt.clusterIcon) opt.clusterIcon = null;
		if(!opt.clusterFontColor) opt.clusterFontColor = '#000';
		if(!opt.clusterFontSize) opt.clusterFontSize = '12px';
		if(!opt.clusterFontFamily) opt.clusterFontFamily = 'sans-serif';
		if(!opt.clusterFontWeight) opt.clusterFontWeight = 'normal';
		if(!opt.markerFontColor) opt.markerFontColor = '#000';
		if(!opt.markerFontSize) opt.markerFontSize = '12px';
		if(!opt.markerFontFamily) opt.markerFontFamily = 'sans-serif';
		if(!opt.markerFontWeight) opt.markerFontWeight = 'normal';
		if(!opt.markerIcon) opt.markerIcon = null;
		if(!opt.onMarkerClick) opt.onMarkerClick = null;

		GV.map = map;
		GV.opt = opt;
		GV.markers = new Map();
		GV.kcluster = new kCluster();
	}

	/**
	 * set options
	 * @param opt
	 */
	function setOptions(opt) {
		console.log('KnGmapClusterer.setOptions()', opt);

		GV.opt.clickToZoom = opt.clickToZoom || GV.opt.clickToZoom;
		GV.opt.clusterIcon = opt.clusterIcon || GV.opt.clusterIcon;
		GV.opt.clusterFontColor = opt.clusterFontColor || GV.opt.clusterFontColor;
		GV.opt.clusterFontSize = opt.clusterFontSize || GV.opt.clusterFontSize;
		GV.opt.clusterFontFamily = opt.clusterFontFamily || GV.opt.clusterFontFamily;
		GV.opt.clusterFontWeight = opt.clusterFontWeight || GV.opt.clusterFontWeight;
		GV.opt.markerFontColor = opt.markerFontColor || GV.opt.markerFontColor;
		GV.opt.markerFontSize = opt.markerFontSize || GV.opt.markerFontSize;
		GV.opt.markerFontFamily = opt.markerFontFamily || GV.opt.markerFontFamily;
		GV.opt.markerFontWeight = opt.markerFontWeight || GV.opt.markerFontWeight;
		GV.opt.markerIcon = opt.markerIcon || GV.opt.markerIcon;
		GV.opt.onMarkerClick = opt.onMarkerClick || GV.opt.onMarkerClick;
	}

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

		// Reset the max zoom
		GV.map.setOptions({ maxZoom: undefined });
	}

	/**
	 * remove idle listener
	 */
	function removeIdleListener() {
		console.log('KnGmapClusterer.removeIdleListener()');
		if(!GV.idle_listener) return;
		GV.idle_listener.remove();
		GV.idle_listener = null;
	}

	/**
	 * load points
	 * @param points
	 */
	function load(points) {
		console.log('KnGmapClusterer.load()');

		// Clear markers
		clearMarkers();

		// Min one point
		if(points.length > 0) {
			// Load points into supercluster
			GV.kcluster.load(points);

			// Max zoom for the fit bounds
			GV.map.setOptions({ maxZoom: 17 });

			// Fit map to bounds
			const bounds = new google.maps.LatLngBounds();
			points.forEach(p => bounds.extend({lat: p.y, lng: p.x}));
			GV.map.fitBounds(bounds);
		}

		// Add the idle listener => drawClusters
		addIdleListener();
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

			if(c.cluster_id) {
				if(old_markers.has('c' + c.cluster_id)) {
					console.log('KnGmapClusterer.drawClusters() cluster already on map');
					GV.markers.set('c' + c.cluster_id, old_markers.get('c' + c.cluster_id));
					old_markers.delete('c' + c.cluster_id);
					return;
				}

				addClusterToMap(c);
			} else {
				if(old_markers.has('m' + c.id)) {
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
			k_data: c,
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

		if(GV.opt.clickToZoom) marker.k_click_listener = marker.addListener('click', onClusterClick);

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
			center: this.getPosition(),
			zoom: GV.kcluster.getClusterExpansionZoom(this.k_data.cluster_id)
		});
	}

	/**
	 * add marker to map
	 * @param m
	 */
	function addMarkerToMap(m) {
		console.log('KnGmapClusterer.addMarkerToMap()', m);

		const marker = new google.maps.Marker({
			k_data: m,
			map: GV.map,
			icon: (typeof GV.opt.markerIcon == 'function' ? GV.opt.markerIcon(m) : GV.opt.markerIcon) || null,
			position: { lat: m.y, lng: m.x }
		});

		if(m.label) marker.setLabel({
			text: m.label,
			color: GV.opt.markerFontColor,
			fontSize: GV.opt.markerFontSize,
			fontWeight: GV.opt.markerFontWeight,
			fontFamily: GV.opt.markerFontFamily
		});

		if(GV.opt.onMarkerClick) marker.k_click_listener = marker.addListener('click', GV.opt.onMarkerClick);

		GV.markers.set('m' + m.id, marker);
	}

	/**
	 * get markers
	 * @return array
	 */
	function getMarkers() {
		console.log('KnGmapClusterer.getMarkers()');
		return GV.markers;
	}

	/**
	 * remove marker from map
	 * @param m
	 */
	function removeMarkerFromMap(m) {
		console.log('KnGmapClusterer.removeMarkerFromMap()', m);
		if(m.k_click_listener) m.k_click_listener.remove();
		m.setMap(null);
	}

	/**
	 * clear markers
	 */
	function clearMarkers() {
		console.log('KnGmapClusterer.clearMarkers()');
		removeIdleListener();
		GV.markers.forEach(m => removeMarkerFromMap(m));
		GV.markers.clear();
	}

	/************************************************************
	 * Custom version of github.com/mapbox/supercluster v7.1.4
	 ***********************************************************/

	class kCluster {
		constructor() {
			this.trees = new Array(GV.opt.maxZoom + 1);
		}

		load(points) {
			this.points = points;

			let clusters = [];
			points.forEach((p, i) => clusters.push(createPointCluster(p, i)));
			this.trees[GV.opt.maxZoom + 1] = new KDBush(clusters);

			for (let z = GV.opt.maxZoom; z >= GV.opt.minZoom; z--) {
				clusters = this._cluster(clusters, z);
				this.trees[z] = new KDBush(clusters);
			}

			return this;
		}

		getClusters(bbox, zoom) {
			let minLng = ((bbox[0] + 180) % 360 + 360) % 360 - 180;
			const minLat = Math.max(-90, Math.min(90, bbox[1]));
			let maxLng = bbox[2] === 180 ? 180 : ((bbox[2] + 180) % 360 + 360) % 360 - 180;
			const maxLat = Math.max(-90, Math.min(90, bbox[3]));

			if (bbox[2] - bbox[0] >= 360) {
				minLng = -180;
				maxLng = 180;
			} else if (minLng > maxLng) {
				const easternHem = this.getClusters([minLng, minLat, 180, maxLat], zoom);
				const westernHem = this.getClusters([-180, minLat, maxLng, maxLat], zoom);
				return easternHem.concat(westernHem);
			}

			const tree = this.trees[this._limitZoom(zoom)];
			const clusters = [];

			tree.range(lngX(minLng), latY(maxLat), lngX(maxLng), latY(minLat)).forEach(id => {
				const c = tree.points[id];
				clusters.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
			});

			return clusters;
		}

		getChildren(clusterId) {
			const originId = this._getOriginId(clusterId);
			const originZoom = this._getOriginZoom(clusterId);
			const errorMsg = 'No cluster with the specified id.';

			const index = this.trees[originZoom];
			if (!index) throw new Error(errorMsg);

			const origin = index.points[originId];
			if (!origin) throw new Error(errorMsg);

			const r = GV.opt.radius / (GV.opt.extent * Math.pow(2, originZoom - 1));
			const children = [];

			index.within(origin.x, origin.y, r).forEach(id => {
				const c = index.points[id];
				if(c.parentId === clusterId) children.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
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

		_limitZoom(z) {
			return Math.max(GV.opt.minZoom, Math.min(+z, GV.opt.maxZoom + 1));
		}

		_cluster(points, zoom) {
			const clusters = [];
			const r = GV.opt.radius / (GV.opt.extent * Math.pow(2, zoom));

			points.forEach((p,i) => {
				if (p.zoom <= zoom) return;
				p.zoom = zoom;

				const tree = this.trees[zoom + 1];
				const neighborIds = tree.within(p.x, p.y, r);

				const numPointsOrigin = p.numPoints || 1;
				let numPoints = numPointsOrigin;

				neighborIds.forEach(neighborId => {
					const b = tree.points[neighborId];
					if (b.zoom > zoom) numPoints += b.numPoints || 1;
				});

				if (numPoints > numPointsOrigin && numPoints >= GV.opt.minPoints) {
					let wx = p.x * numPointsOrigin;
					let wy = p.y * numPointsOrigin;

					const id = (i << 5) + (zoom + 1) + this.points.length;

					neighborIds.forEach(neighborId => {
						const b = tree.points[neighborId];

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
							const b = tree.points[neighborId];
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

	const fround = Math.fround || (tmp => ((x) => { tmp[0] = +x; return tmp[0]; }))(new Float32Array(1));

	function createCluster(x, y, id, numPoints) {
		return {
			x: fround(x),
			y: fround(y),
			zoom: Infinity,
			id,
			parentId: -1,
			numPoints
		};
	}

	function createPointCluster(p, id) {
		return {
			x: fround(lngX(p.x)),
			y: fround(latY(p.y)),
			zoom: Infinity,
			index: id,
			parentId: -1
		};
	}

	function getClusterJSON(cluster) {
		const count = cluster.numPoints;
		const abbrev =
			count >= 10000 ? `${Math.round(count / 1000)  }k` :
			count >= 1000 ? `${Math.round(count / 100) / 10  }k` : count;

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
		const sin = Math.sin(lat * Math.PI / 180);
		const y = (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);
		return y < 0 ? 0 : y > 1 ? 1 : y;
	}

	function xLng(x) {
		return (x - 0.5) * 360;
	}

	function yLat(y) {
		const y2 = (180 - y * 360) * Math.PI / 180;
		return 360 * Math.atan(Math.exp(y2)) / Math.PI - 90;
	}

	/************************************************************
	 * Custom version of github.com/mourner/kdbush v3.0.0
	 ***********************************************************/

	class KDBush {
		constructor(points) {
			this.points = points;

			const IndexArrayType = points.length < 65536 ? Uint16Array : Uint32Array;

			const ids = this.ids = new IndexArrayType(points.length);
			const coords = this.coords = new Float32Array(points.length * 2);

			for (let i = 0; i < points.length; i++) {
				ids[i] = i;
				coords[2 * i] = points[i].x;
				coords[2 * i + 1] = points[i].y;
			}

			sortKD(ids, coords, 0, ids.length - 1, 0);
		}

		range(minX, minY, maxX, maxY) {
			return rangeKD(this.ids, this.coords, minX, minY, maxX, maxY);
		}

		within(x, y, r) {
			return withinKD(this.ids, this.coords, x, y, r);
		}
	}

	function rangeKD(ids, coords, minX, minY, maxX, maxY) {
		const stack = [0, ids.length - 1, 0];
		const result = [];
		let x, y;

		while (stack.length) {
			const axis = stack.pop();
			const right = stack.pop();
			const left = stack.pop();

			if (right - left <= GV.opt.nodeSize) {
				for (let i = left; i <= right; i++) {
					x = coords[2 * i];
					y = coords[2 * i + 1];
					if (x >= minX && x <= maxX && y >= minY && y <= maxY) result.push(ids[i]);
				}
				continue;
			}

			const m = Math.floor((left + right) / 2);

			x = coords[2 * m];
			y = coords[2 * m + 1];

			if (x >= minX && x <= maxX && y >= minY && y <= maxY) result.push(ids[m]);

			const nextAxis = (axis + 1) % 2;

			if (axis === 0 ? minX <= x : minY <= y) {
				stack.push(left);
				stack.push(m - 1);
				stack.push(nextAxis);
			}
			if (axis === 0 ? maxX >= x : maxY >= y) {
				stack.push(m + 1);
				stack.push(right);
				stack.push(nextAxis);
			}
		}

		return result;
	}

	function sortKD(ids, coords, left, right, depth) {
		if (right - left <= GV.opt.nodeSize) return;

		const m = (left + right) >> 1;

		select(ids, coords, m, left, right, depth % 2);

		sortKD(ids, coords, left, m - 1, depth + 1);
		sortKD(ids, coords, m + 1, right, depth + 1);
	}

	function select(ids, coords, k, left, right, inc) {
		while (right > left) {
			if (right - left > 600) {
				const n = right - left + 1;
				const m = k - left + 1;
				const z = Math.log(n);
				const s = 0.5 * Math.exp(2 * z / 3);
				const sd = 0.5 * Math.sqrt(z * s * (n - s) / n) * (m - n / 2 < 0 ? -1 : 1);
				const newLeft = Math.max(left, Math.floor(k - m * s / n + sd));
				const newRight = Math.min(right, Math.floor(k + (n - m) * s / n + sd));
				select(ids, coords, k, newLeft, newRight, inc);
			}

			const t = coords[2 * k + inc];
			let i = left;
			let j = right;

			swapItem(ids, coords, left, k);
			if (coords[2 * right + inc] > t) swapItem(ids, coords, left, right);

			while (i < j) {
				swapItem(ids, coords, i, j);
				i++;
				j--;
				while (coords[2 * i + inc] < t) i++;
				while (coords[2 * j + inc] > t) j--;
			}

			if (coords[2 * left + inc] === t) swapItem(ids, coords, left, j);
			else {
				j++;
				swapItem(ids, coords, j, right);
			}

			if (j <= k) left = j + 1;
			if (k <= j) right = j - 1;
		}
	}

	function swapItem(ids, coords, i, j) {
		swap(ids, i, j);
		swap(coords, 2 * i, 2 * j);
		swap(coords, 2 * i + 1, 2 * j + 1);
	}

	function swap(arr, i, j) {
		const tmp = arr[i];
		arr[i] = arr[j];
		arr[j] = tmp;
	}

	function withinKD(ids, coords, qx, qy, r) {
		const stack = [0, ids.length - 1, 0];
		const result = [];
		const r2 = r * r;

		while (stack.length) {
			const axis = stack.pop();
			const right = stack.pop();
			const left = stack.pop();

			if (right - left <= GV.opt.nodeSize) {
				for (let i = left; i <= right; i++) {
					if (sqDist(coords[2 * i], coords[2 * i + 1], qx, qy) <= r2) result.push(ids[i]);
				}
				continue;
			}

			const m = Math.floor((left + right) / 2);

			const x = coords[2 * m];
			const y = coords[2 * m + 1];

			if (sqDist(x, y, qx, qy) <= r2) result.push(ids[m]);

			const nextAxis = (axis + 1) % 2;

			if (axis === 0 ? qx - r <= x : qy - r <= y) {
				stack.push(left);
				stack.push(m - 1);
				stack.push(nextAxis);
			}
			if (axis === 0 ? qx + r >= x : qy + r >= y) {
				stack.push(m + 1);
				stack.push(right);
				stack.push(nextAxis);
			}
		}

		return result;
	}

	function sqDist(ax, ay, bx, by) {
		const dx = ax - bx;
		const dy = ay - by;
		return dx * dx + dy * dy;
	}

	/*************************************************
	 * PUBLIC METHODS
	 ************************************************/

	return {
		VERSION,
		init,
		setOptions,
		load,
		getMarkers,
		clearMarkers
	}
}();
