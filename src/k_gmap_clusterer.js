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
