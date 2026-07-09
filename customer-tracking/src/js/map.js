let map = null;
let driverMarker = null;
let routePolyline = null;
let destinationMarker = null;
let isMapReady = false;

const DEFAULT_CENTER = [10.762622, 106.660172];

function initMap() {
  if (isMapReady) return;

  map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19
  }).addTo(map);

  driverMarker = L.marker(DEFAULT_CENTER, {
    icon: L.divIcon({
      className: 'tracking-driver-marker',
      html: '<div style="font-size:30px;line-height:1;">🛵</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  }).addTo(map);

  routePolyline = L.polyline([], {
    color: '#3b82f6',
    weight: 5,
    opacity: 0.7
  }).addTo(map);

  isMapReady = true;
}

function updateDriverPosition(lat, lng) {
  if (!isMapReady) return;

  const position = [lat, lng];
  driverMarker.setLatLng(position);

  const currentLatLngs = routePolyline.getLatLngs();
  const last = currentLatLngs[currentLatLngs.length - 1];
  if (!last || last.lat !== lat || last.lng !== lng) {
    currentLatLngs.push(position);
    routePolyline.setLatLngs(currentLatLngs.slice(-80));
  }

  map.setView(position, Math.max(map.getZoom(), 14), { animate: true });
}

function fitRoute(latlngs) {
  if (!isMapReady || !latlngs || latlngs.length === 0) return;

  routePolyline.setLatLngs(latlngs);
  map.fitBounds(routePolyline.getBounds(), { padding: [40, 40] });
}

function setDestination(lat, lng) {
  if (!isMapReady) return;

  if (destinationMarker) {
    destinationMarker.setLatLng([lat, lng]);
  } else {
    destinationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'tracking-destination-marker',
        html: '<div style="font-size:26px;line-height:1;">📍</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 26]
      })
    }).addTo(map);
  }
}

function resetMap() {
  if (!isMapReady) return;
  routePolyline.setLatLngs([]);
  driverMarker.setLatLng(DEFAULT_CENTER);
  if (destinationMarker) {
    destinationMarker.setLatLng(DEFAULT_CENTER);
  }
  map.setView(DEFAULT_CENTER, 14);
}

window.CustomerTrackingMap = {
  initMap,
  updateDriverPosition,
  fitRoute,
  setDestination,
  resetMap,
  get isMapReady() { return isMapReady; }
};
