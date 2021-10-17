'use strict';

kGmapClusterer = {
	VERSION: '1.0.1',
	Clusterer: class Clusterer {
		/**
		 * class constructor
		 * @param map
		 * @param opt
		 */
		constructor(map, opt) {
			console.log('Clusterer.constructor()', map, opt);

			this.mMap = map;

			if(!opt) opt = {};
			if(!opt.minZoom) opt.minZoom = 0;
			if(!opt.maxZoom) opt.maxZoom = 17;
			if(!opt.minPoints) opt.minPoints = 2;
			if(!opt.radius) opt.radius = 256;
			if(!opt.clickToZoom) opt.clickToZoom = true;
			if(!opt.hideDuplicate) opt.hideDuplicate = false;
			if(!opt.clusterIcon) opt.clusterIcon = null;
			if(!opt.clusterFontColor) opt.clusterFontColor = '#000';
			if(!opt.clusterFontSize) opt.clusterFontSize = '12px';
			if(!opt.clusterFontFamily) opt.clusterFontFamily = 'sans-serif';
			if(!opt.clusterFontWeight) opt.clusterFontWeight = 'normal';
			if(!opt.markerIcon) opt.markerIcon = null;
			if(!opt.onMarkerClick) opt.onMarkerClick = null;
			this.mOpt = opt;

			this.mSuperCluster = new Supercluster({
				minZoom: opt.minZoom,
				maxZoom: opt.maxZoom,
				minPoints: opt.minPoints,
				radius: opt.radius
			});
		}

		/**
		 * set options
		 * @param opt
		 */
		setOptions(opt) {
			console.log('Clusterer.setOptions()', opt);

			if(!opt) opt = {};
			this.mOpt.clickToZoom = opt.clickToZoom || this.mOpt.clickToZoom;
			this.mOpt.hideDuplicate = opt.hideDuplicate || this.mOpt.hideDuplicate;
			this.mOpt.clusterIcon = opt.clusterIcon || this.mOpt.clusterIcon;
			this.mOpt.clusterFontColor = opt.clusterFontColor || this.mOpt.clusterFontColor;
			this.mOpt.clusterFontSize = opt.clusterFontSize || this.mOpt.clusterFontSize;
			this.mOpt.clusterFontFamily = opt.clusterFontFamily || this.mOpt.clusterFontFamily;
			this.mOpt.clusterFontWeight = opt.clusterFontWeight || this.mOpt.clusterFontWeight;
			this.mOpt.markerIcon = opt.markerIcon || this.mOpt.markerIcon;
			this.mOpt.onMarkerClick = opt.onMarkerClick || this.mOpt.onMarkerClick;
		}

		/**
		 * Set the idle listener
		 */
		initIdleListener() {
			console.log('Clusterer.initIdleListener()');
			this.mIdleListener = this.mMap.addListener('idle', () => this.getClusters());
		}

		/**
		 * Remove the idle listener
		 */
		removeIdleListener() {
			console.log('Clusterer.removeIdleListener()');
			if(this.mIdleListener) this.mIdleListener.remove();
		}

		/**
		 * get features bounds
		 * @return LatLngBounds
		 */
		getFeaturesBounds() {
			console.log('Clusterer.getFeaturesBounds()');

			const bounds = new google.maps.LatLngBounds();

			this.mSuperCluster.points.forEach(f => bounds.extend({
				lat: f.geometry.coordinates[1],
				lng: f.geometry.coordinates[0]
			}));

			return bounds;
		}

		/**
		 * fit map to features
		 */
		fitMapToFeaturesBounds() {
			console.log('Clusterer.fitMapToFeaturesBounds()');
			this.mMap.fitBounds(this.getFeaturesBounds());
		}

		/**
		 * load features into supercluster
		 * @param features
		 */
		load(features) {
			console.log('Clusterer.load()', features);

			this.clearMarkers();
			this.mSuperCluster.load(features);
			this.fitMapToFeaturesBounds();

			google.maps.event.addListenerOnce(this.mMap, 'idle', () => {
				this.getClusters();
				this.initIdleListener();
			});
		}

		/**
		 * get clusters from supercluster
		 */
		getClusters() {
			console.log('Clusterer.getClusters()');

			const bounds = this.mMap.getBounds();

			const clusters = this.mSuperCluster.getClusters([
				bounds.getSouthWest().lng(),
				bounds.getSouthWest().lat(),
				bounds.getNorthEast().lng(),
				bounds.getNorthEast().lat()
			], this.mMap.getZoom());

			this.drawClusters(clusters);
		}

		/**
		 * draw clusters
		 * @param clusters
		 */
		drawClusters(clusters) {
			console.log('Clusterer.drawClusters()', clusters);

			if(!this.mMarkers) this.mMarkers = [];
			const onMap = this.getMarkersOnMap();
			this.mMarkers = [];

			clusters.forEach(c => {
				if(c.properties && c.properties.cluster === true) {
					if(onMap.clusters.get(c.properties.cluster_id)) {
						this.mMarkers.push(onMap.clusters.get(c.properties.cluster_id));
						onMap.clusters.delete(c.properties.cluster_id);
						return;
					}

					this.addClusterToMap(c);
				} else {
					if(onMap.markers.get(c.id)) {
						this.mMarkers.push(onMap.markers.get(c.id));
						onMap.markers.delete(c.id);
						return;
					}

					this.addMarkerToMap(c);
				}
			});

			setTimeout(() => {
				onMap.clusters.forEach(c => this.deleteMarkerFromMap(c));
				onMap.markers.forEach(m => this.deleteMarkerFromMap(m));
			}, 0);
		}

		/**
		 * get markers on map
		 */
		getMarkersOnMap() {
			console.log('Clusterer.drawClusters()');

			const clusters = new Map(), markers = new Map();

			this.mMarkers.forEach(m => {
				if(m.get('cluster_id')) clusters.set(m.get('cluster_id'), m);
				else markers.set(m.get('id'), m);
			});

			return { clusters, markers };
		}

		/**
		 * add cluster to map
		 * @param cluster
		 */
		addClusterToMap(cluster) {
			console.log('Clusterer.addClusterToMap()', cluster);

			const m = new google.maps.Marker({
				map: this.mMap,
				icon: (typeof this.mOpt.clusterIcon == 'function' ? this.mOpt.clusterIcon(cluster) : this.mOpt.clusterIcon) || null,
				zIndex: Number(google.maps.Marker.MAX_ZINDEX) + cluster.properties.point_count,
				position: {
					lat: cluster.geometry.coordinates[1],
					lng: cluster.geometry.coordinates[0]
				},
				label: {
					text: String(cluster.properties.point_count_abbreviated),
					color: this.mOpt.clusterFontColor,
					fontSize: this.mOpt.clusterFontSize,
					fontWeight: this.mOpt.clusterFontWeight,
					fontFamily: this.mOpt.clusterFontFamily
				}
			});

			m.set('cluster_id', cluster.properties.cluster_id);

			if(this.mOpt.clickToZoom) m.set('click_listener', m.addListener('click', e => {
				e.stop();
				this.mMap.setOptions({
					center: m.getPosition(),
					zoom: this.mSuperCluster.getClusterExpansionZoom(m.get('cluster_id'))
				});
			}));

			this.mMarkers.push(m);
		}

		/**
		 * add marker to map
		 * @param marker
		 */
		addMarkerToMap(marker) {
			console.log('Clusterer.addMarkerToMap()', marker);

			const positon = new google.maps.LatLng(marker.geometry.coordinates[1], marker.geometry.coordinates[0]);

			if(this.mOpt.hideDuplicate) {
				let duplicate = false;

				for(let i in this.mMarkers) {
					if(!this.mMarkers[i].position.equals(positon)) continue;

					duplicate = true;

					if(this.mMarkers[i].get('duplicates')) this.mMarkers[i].get('duplicates').push(marker.id);
					else this.mMarkers[i].set('duplicates', [marker.id]);

					break;
				}

				if(duplicate) return;
			}

			const m = new google.maps.Marker({
				map: this.mMap,
				icon: (typeof this.mOpt.markerIcon == 'function' ? this.mOpt.markerIcon(marker) : this.mOpt.markerIcon) || null,
				position: positon
			});

			m.set('id', marker.id);

			if(this.mOpt.onMarkerClick) m.set('click_listener', m.addListener('click', e => {
				e.stop();
				this.mOpt.onMarkerClick(m);
			}));

			this.mMarkers.push(m);
		}

		/**
		 * delete marker from map
		 * @param marker
		 */
		deleteMarkerFromMap(marker) {
			console.log('Clusterer.deleteMarkerFromMap()', marker);
			if(marker.get('click_listener')) marker.get('click_listener').remove();
			marker.setMap(null);
		}

		/**
		 * clear on map marker
		 */
		clearOnMapMarker() {
			console.log('Clusterer.clearOnMapMarker()');
			if(!this.mMarkers) return;
			this.mMarkers.forEach(m => this.deleteMarkerFromMap(m));
			this.mMarkers = [];
		}

		/**
		 * clear markers
		 */
		clearMarkers() {
			console.log('Clusterer.clearMarkers()');
			this.removeIdleListener();
			this.clearOnMapMarker();
		}
	}
};
