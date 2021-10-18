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
