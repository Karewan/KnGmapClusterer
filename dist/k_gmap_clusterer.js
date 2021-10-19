/**
 * kGmapClusterer v2.0.1 (2021-10-19 09:53:16 +0200)
 * Copyright (c) 2021 Florent VIALATTE
 * Released under the MIT license
 */

!function(t,o){"object"==typeof exports&&"undefined"!=typeof module?module.exports=o():"function"==typeof define&&define.amd?define(o):t.KDBush=o()}(this,function(){"use strict";function t(n,r,i,e,h,u){if(!(h-e<=i)){var s=e+h>>1;!function t(n,r,i,e,h,u){for(;h>e;){if(h-e>600){var s=h-e+1,f=i-e+1,p=Math.log(s),a=.5*Math.exp(2*p/3),d=.5*Math.sqrt(p*a*(s-a)/s)*(f-s/2<0?-1:1),v=Math.max(e,Math.floor(i-f*a/s+d)),c=Math.min(h,Math.floor(i+(s-f)*a/s+d));t(n,r,i,v,c,u)}var l=r[2*i+u],g=e,M=h;for(o(n,r,e,i),r[2*h+u]>l&&o(n,r,e,h);g<M;){for(o(n,r,g,M),g++,M--;r[2*g+u]<l;)g++;for(;r[2*M+u]>l;)M--}r[2*e+u]===l?o(n,r,e,M):o(n,r,++M,h),M<=i&&(e=M+1),i<=M&&(h=M-1)}}(n,r,s,e,h,u%2),t(n,r,i,e,s-1,u+1),t(n,r,i,s+1,h,u+1)}}function o(t,o,r,i){n(t,r,i),n(o,2*r,2*i),n(o,2*r+1,2*i+1)}function n(t,o,n){var r=t[o];t[o]=t[n],t[n]=r}function r(t,o,n,r){var i=t-n,e=o-r;return i*i+e*e}var i=function(t){return t[0]},e=function(t){return t[1]},h=function(o,n,r,h,u){void 0===n&&(n=i),void 0===r&&(r=e),void 0===h&&(h=64),void 0===u&&(u=Float64Array),this.nodeSize=h,this.points=o;for(var s=o.length<65536?Uint16Array:Uint32Array,f=this.ids=new s(o.length),p=this.coords=new u(2*o.length),a=0;a<o.length;a++)f[a]=a,p[2*a]=n(o[a]),p[2*a+1]=r(o[a]);t(f,p,h,0,f.length-1,0)};return h.prototype.range=function(t,o,n,r){return function(t,o,n,r,i,e,h){for(var u,s,f=[0,t.length-1,0],p=[];f.length;){var a=f.pop(),d=f.pop(),v=f.pop();if(d-v<=h)for(var c=v;c<=d;c++)u=o[2*c],s=o[2*c+1],u>=n&&u<=i&&s>=r&&s<=e&&p.push(t[c]);else{var l=Math.floor((v+d)/2);u=o[2*l],s=o[2*l+1],u>=n&&u<=i&&s>=r&&s<=e&&p.push(t[l]);var g=(a+1)%2;(0===a?n<=u:r<=s)&&(f.push(v),f.push(l-1),f.push(g)),(0===a?i>=u:e>=s)&&(f.push(l+1),f.push(d),f.push(g))}}return p}(this.ids,this.coords,t,o,n,r,this.nodeSize)},h.prototype.within=function(t,o,n){return function(t,o,n,i,e,h){for(var u=[0,t.length-1,0],s=[],f=e*e;u.length;){var p=u.pop(),a=u.pop(),d=u.pop();if(a-d<=h)for(var v=d;v<=a;v++)r(o[2*v],o[2*v+1],n,i)<=f&&s.push(t[v]);else{var c=Math.floor((d+a)/2),l=o[2*c],g=o[2*c+1];r(l,g,n,i)<=f&&s.push(t[c]);var M=(p+1)%2;(0===p?n-e<=l:i-e<=g)&&(u.push(d),u.push(c-1),u.push(M)),(0===p?n+e>=l:i+e>=g)&&(u.push(c+1),u.push(a),u.push(M))}}return s}(this.ids,this.coords,t,o,n,this.nodeSize)},h});

const defaultOptions = {
	minZoom: 0,   // min zoom to generate clusters on
	maxZoom: 16,  // max zoom level to cluster the points on
	minPoints: 2, // minimum points to form a cluster
	radius: 40,   // cluster radius in pixels
	extent: 512,  // tile extent (radius is calculated relative to it)
	nodeSize: 64, // size of the KD-tree leaf node, affects performance

	// properties to use for individual points when running the reducer
	map: props => props // props => ({sum: props.my_value})
};

const fround = Math.fround || (tmp => ((x) => { tmp[0] = +x; return tmp[0]; }))(new Float32Array(1));

class Supercluster {
	constructor(options) {
		this.options = extend(Object.create(defaultOptions), options);
		this.trees = new Array(this.options.maxZoom + 1);
	}

	load(points) {
		const {minZoom, maxZoom, nodeSize} = this.options;

		this.points = points;

		// generate a cluster object for each point and index input points into a KD-tree
		let clusters = [];
		points.forEach((p, i) => clusters.push(createPointCluster(p, i)));
		this.trees[maxZoom + 1] = new KDBush(clusters, getX, getY, nodeSize, Float32Array);


		// cluster points on max zoom, then cluster the results on previous zoom, etc.;
		// results in a cluster hierarchy across zoom levels
		for (let z = maxZoom; z >= minZoom; z--) {
			// create a new set of clusters for the zoom and index them with a KD-tree
			clusters = this._cluster(clusters, z);
			this.trees[z] = new KDBush(clusters, getX, getY, nodeSize, Float32Array);
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
		const ids = tree.range(lngX(minLng), latY(maxLat), lngX(maxLng), latY(minLat));
		const clusters = [];
		for (const id of ids) {
			const c = tree.points[id];
			clusters.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
		}
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

		const r = this.options.radius / (this.options.extent * Math.pow(2, originZoom - 1));
		const ids = index.within(origin.x, origin.y, r);
		const children = [];
		for (const id of ids) {
			const c = index.points[id];
			if (c.parentId === clusterId) {
				children.push(c.numPoints ? getClusterJSON(c) : this.points[c.index]);
			}
		}

		if (children.length === 0) throw new Error(errorMsg);

		return children;
	}

	getClusterExpansionZoom(clusterId) {
		let expansionZoom = this._getOriginZoom(clusterId) - 1;
		while (expansionZoom <= this.options.maxZoom) {
			const children = this.getChildren(clusterId);
			expansionZoom++;
			if (children.length !== 1) break;
			clusterId = children[0].d.cluster_id;
		}
		return expansionZoom;
	}

	_limitZoom(z) {
		return Math.max(this.options.minZoom, Math.min(+z, this.options.maxZoom + 1));
	}

	_cluster(points, zoom) {
		const clusters = [];
		const {radius, extent, minPoints} = this.options;
		const r = radius / (extent * Math.pow(2, zoom));

		// loop through each point
		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			// if we've already visited the point at this zoom level, skip it
			if (p.zoom <= zoom) continue;
			p.zoom = zoom;

			// find all nearby points
			const tree = this.trees[zoom + 1];
			const neighborIds = tree.within(p.x, p.y, r);

			const numPointsOrigin = p.numPoints || 1;
			let numPoints = numPointsOrigin;

			// count the number of points in a potential cluster
			for (const neighborId of neighborIds) {
				const b = tree.points[neighborId];
				// filter out neighbors that are already processed
				if (b.zoom > zoom) numPoints += b.numPoints || 1;
			}

			// if there were neighbors to merge, and there are enough points to form a cluster
			if (numPoints > numPointsOrigin && numPoints >= minPoints) {
				let wx = p.x * numPointsOrigin;
				let wy = p.y * numPointsOrigin;

				let clusterProperties = numPointsOrigin > 1 ? this._map(p, true) : null;

				// encode both zoom and point index on which the cluster originated -- offset by total length of features
				const id = (i << 5) + (zoom + 1) + this.points.length;

				for (const neighborId of neighborIds) {
					const b = tree.points[neighborId];

					if (b.zoom <= zoom) continue;
					b.zoom = zoom; // save the zoom (so it doesn't get processed twice)

					const numPoints2 = b.numPoints || 1;
					wx += b.x * numPoints2; // accumulate coordinates for calculating weighted center
					wy += b.y * numPoints2;

					b.parentId = id;
				}

				p.parentId = id;
				clusters.push(createCluster(wx / numPoints, wy / numPoints, id, numPoints, clusterProperties));

			} else { // left points as unclustered
				clusters.push(p);

				if (numPoints > 1) {
					for (const neighborId of neighborIds) {
						const b = tree.points[neighborId];
						if (b.zoom <= zoom) continue;
						b.zoom = zoom;
						clusters.push(b);
					}
				}
			}
		}

		return clusters;
	}

	// get index of the point from which the cluster originated
	_getOriginId(clusterId) {
		return (clusterId - this.points.length) >> 5;
	}

	// get zoom of the point from which the cluster originated
	_getOriginZoom(clusterId) {
		return (clusterId - this.points.length) % 32;
	}

	_map(point, clone) {
		if (point.numPoints) {
			return clone ? extend({}, point.d) : point.d;
		}
		const original = this.points[point.index].d;
		const result = this.options.map(original);
		return clone && result === original ? extend({}, result) : result;
	}
}

function createCluster(x, y, id, numPoints, d) {
	return {
		x: fround(x), // weighted cluster center; round for consistency with Float32Array index
		y: fround(y),
		zoom: Infinity, // the last zoom the cluster was processed at
		id, // encodes index of the first child of the cluster and its zoom level
		parentId: -1, // parent cluster id
		numPoints,
		d
	};
}

function createPointCluster(p, id) {
	return {
		x: fround(lngX(p.x)), // projected point coordinates
		y: fround(latY(p.y)),
		zoom: Infinity, // the last zoom the point was processed at
		index: id, // index of the source feature in the original input array,
		parentId: -1 // parent cluster id
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

// longitude/latitude to spherical mercator in [0..1] range
function lngX(lng) {
	return lng / 360 + 0.5;
}
function latY(lat) {
	const sin = Math.sin(lat * Math.PI / 180);
	const y = (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);
	return y < 0 ? 0 : y > 1 ? 1 : y;
}

// spherical mercator to longitude/latitude
function xLng(x) {
	return (x - 0.5) * 360;
}
function yLat(y) {
	const y2 = (180 - y * 360) * Math.PI / 180;
	return 360 * Math.atan(Math.exp(y2)) / Math.PI - 90;
}

function extend(dest, src) {
	for (const id in src) dest[id] = src[id];
	return dest;
}

function getX(p) {
	return p.x;
}
function getY(p) {
	return p.y;
}

'use strict';

const kGmapClusterer = function() {
	const VERSION = '2.0.1',
	GV = {};

	/**
	 * init kGmapClusterer
	 * @param map
	 * @param opt
	 */
	function init(map, opt) {
		console.log('kGmapClusterer.init()');

		if(!opt) opt = {};
		if(!opt.minZoom) opt.minZoom = 0;
		if(!opt.maxZoom) opt.maxZoom = 16;
		if(!opt.minPoints) opt.minPoints = 2;
		if(!opt.radius) opt.radius = 256;
		if(!opt.extent) opt.extent = 512;
		if(!opt.nodeSize) opt.nodeSize = 64;
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
		GV.supercluster = new Supercluster({
			minZoom: opt.minZoom,
			maxZoom: opt.maxZoom,
			minPoints: opt.minPoints,
			radius: opt.radius,
			extent: opt.extent,
			nodeSize: opt.nodeSize
		});
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

	return {
		VERSION,
		init,
		setOptions,
		load,
		getMarkers,
		clearMarkers
	}
}();
