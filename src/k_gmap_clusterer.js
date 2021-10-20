'use strict';

const kGmapClusterer = function() {
	const VERSION = '2.0.2',
	GV = {};

	/**
	 * init kGmapClusterer
	 * @param map
	 * @param opt
	 */
	function init(map, opt) {
		console.log('kGmapClusterer.init()');

		if(!opt) opt = {};
		if(!opt.minZoom) opt.minZoom = 0; // min zoom to generate clusters on
		if(!opt.maxZoom) opt.maxZoom = 16; // max zoom level to cluster the points on
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
		GV.supercluster = new Supercluster();
	}

	/**
	 * set options
	 * @param opt
	 */
	function setOptions(opt) {
		console.log('kGmapClusterer.setOptions()', opt);

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
		console.log('kGmapClusterer.addIdleListener()');
		GV.idle_listener = GV.map.addListener('idle', onMapIdle);
	}

	/**
	 * on map idle
	 */
	function onMapIdle() {
		console.log('kGmapClusterer.onMapIdle()');
		drawClusters(GV.map.getBounds(), GV.map.getZoom());
	}

	/**
	 * remove idle listener
	 */
	function removeIdleListener() {
		console.log('kGmapClusterer.removeIdleListener()');
		if(!GV.idle_listener) return;
		GV.idle_listener.remove();
		GV.idle_listener = null;
	}

	/**
	 * load points
	 * @param points
	 */
	function load(points) {
		console.log('kGmapClusterer.load()');

		// Clear markers
		clearMarkers();

		// Load point into supercluster
		GV.supercluster.load(points);

		// Fit map to bounds
		const bounds = new google.maps.LatLngBounds();
		points.forEach(p => bounds.extend({lat: p.y, lng: p.x}));
		GV.map.fitBounds(bounds);

		// Add the idle listener => drawClusters
		addIdleListener();
	}

	/**
	 * draw clusters
	 * @param bounds
	 * @param zoom
	 */
	function drawClusters(bounds, zoom) {
		console.log('kGmapClusterer.drawClusters()', bounds, zoom);

		const old_markers = new Map(GV.markers);
		GV.markers.clear();

		GV.supercluster.getClusters([bounds.getSouthWest().lng(), bounds.getSouthWest().lat(), bounds.getNorthEast().lng(), bounds.getNorthEast().lat()], zoom).forEach(c => {
			console.log("kGmapClusterer.drawClusters()", c);

			if(c.d.cluster_id) {
				if(old_markers.has('c' + c.d.cluster_id)) {
					console.log('kGmapClusterer.drawClusters() cluster already on map');
					GV.markers.set('c' + c.d.cluster_id, old_markers.get('c' + c.d.cluster_id));
					old_markers.delete('c' + c.d.cluster_id);
					return;
				}

				addClusterToMap(c);
			} else {
				if(old_markers.has('m' + c.d.id)) {
					console.log('kGmapClusterer.drawClusters() marker already on map');
					GV.markers.set('m' + c.d.id, old_markers.get('m' + c.d.id));
					old_markers.delete('m' + c.d.id);
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
		console.log('kGmapClusterer.addClusterToMap()', c);

		const marker = new google.maps.Marker({
			k_data: c.d,
			map: GV.map,
			icon: (typeof GV.opt.clusterIcon == 'function' ? GV.opt.clusterIcon(c) : GV.opt.clusterIcon) || null,
			zIndex: Number(google.maps.Marker.MAX_ZINDEX) + c.d.nb_points,
			position: { lat: c.y, lng: c.x },
			label: {
				text: String(c.d.nb_points_abbr),
				color: GV.opt.clusterFontColor,
				fontSize: GV.opt.clusterFontSize,
				fontWeight: GV.opt.clusterFontWeight,
				fontFamily: GV.opt.clusterFontFamily
			}
		});

		if(GV.opt.clickToZoom) marker.k_click_listener = marker.addListener('click', onClusterClick);

		GV.markers.set('c' + c.d.cluster_id, marker);
	}

	/**
	 * on cluster click
	 * @param e
	 */
	function onClusterClick(e) {
		console.log('kGmapClusterer.onClusterClick()', e);
		e.stop();
		GV.map.setOptions({
			center: this.getPosition(),
			zoom: GV.supercluster.getClusterExpansionZoom(this.k_data.cluster_id)
		});
	}

	/**
	 * add marker to map
	 * @param m
	 */
	function addMarkerToMap(m) {
		console.log('kGmapClusterer.addMarkerToMap()', m);

		const marker = new google.maps.Marker({
			k_data: m.d,
			map: GV.map,
			icon: (typeof GV.opt.markerIcon == 'function' ? GV.opt.markerIcon(m) : GV.opt.markerIcon) || null,
			position: { lat: m.y, lng: m.x }
		});

		if(m.d.label) marker.setLabel({
			text: m.d.label,
			color: GV.opt.markerFontColor,
			fontSize: GV.opt.markerFontSize,
			fontWeight: GV.opt.markerFontWeight,
			fontFamily: GV.opt.markerFontFamily
		});

		if(GV.opt.onMarkerClick) marker.k_click_listener = marker.addListener('click', GV.opt.onMarkerClick);

		GV.markers.set('m' + m.d.id, marker);
	}

	/**
	 * get markers
	 * @return array
	 */
	function getMarkers() {
		console.log('kGmapClusterer.getMarkers()');
		return GV.markers;
	}

	/**
	 * remove marker from map
	 * @param m
	 */
	function removeMarkerFromMap(m) {
		console.log('kGmapClusterer.removeMarkerFromMap()', m);
		if(m.k_click_listener) m.k_click_listener.remove();
		m.setMap(null);
	}

	/**
	 * clear markers
	 */
	function clearMarkers() {
		console.log('kGmapClusterer.clearMarkers()');
		removeIdleListener();
		GV.markers.forEach(m => removeMarkerFromMap(m));
		GV.markers.clear();
	}


	/*************************************************
	 * CUSTOM SUPERCLUSTER (7.1.4)
	 ************************************************/

	class Supercluster {
		constructor() {
			this.trees = new Array(GV.opt.maxZoom + 1);
		}

		load(points) {
			this.points = points;

			let clusters = [];
			points.forEach((p, i) => clusters.push(createPointCluster(p, i)));
			this.trees[GV.opt.maxZoom + 1] = new KDBush(clusters, getX, getY, GV.opt.nodeSize, Float32Array);

			for (let z = GV.opt.maxZoom; z >= GV.opt.minZoom; z--) {
				clusters = this._cluster(clusters, z);
				this.trees[z] = new KDBush(clusters, getX, getY, GV.opt.nodeSize, Float32Array);
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
				clusterId = children[0].d.cluster_id;
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

					let clusterProperties = numPointsOrigin > 1 ? this._map(p, true) : null;

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
					clusters.push(createCluster(wx / numPoints, wy / numPoints, id, numPoints, clusterProperties));
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

		_map(point, clone) {
			if(point.numPoints) return clone ? extend({}, point.d) : point.d;

			const result = this.points[point.index].d;
			return clone ? extend({}, result) : result;
		}
	}

	const fround = Math.fround || (tmp => ((x) => { tmp[0] = +x; return tmp[0]; }))(new Float32Array(1));

	function createCluster(x, y, id, numPoints, d) {
		return {
			x: fround(x),
			y: fround(y),
			zoom: Infinity,
			id,
			parentId: -1,
			numPoints,
			d
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
		return {
			x: xLng(cluster.x),
			y: yLat(cluster.y),
			d: getClusterProperties(cluster)
		};
	}

	function getClusterProperties(cluster) {
		const count = cluster.numPoints;
		const abbrev =
			count >= 10000 ? `${Math.round(count / 1000)  }k` :
			count >= 1000 ? `${Math.round(count / 100) / 10  }k` : count;

		return extend(extend({}, cluster.d), {
			cluster_id: cluster.id,
			nb_points: count,
			nb_points_abbr: abbrev
		});
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

	function extend(dest, src) {
		for(const id in src) dest[id] = src[id];
		return dest;
	}

	function getX(p) {
		return p.x;
	}

	function getY(p) {
		return p.y;
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
