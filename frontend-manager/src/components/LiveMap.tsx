import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import DriverMarker from './DriverMarker';

const defaultCenter: [number, number] = [10.762622, 106.660172];

interface DriverData {
    lat: number;
    lng: number;
    status: string;
    active_order_id?: string | number | null;
    full_name?: string;
    vehicle_type?: string;
    license_plate?: string;
    last_ping?: number;
}

interface Order {
    id: number;
    customer_name: string;
    customer_phone: string;
    address: string;
    latitude: number;
    longitude: number;
    ship_cod: number;
    status: string;
    driver_id?: number;
}

interface LiveMapProps {
    driversData: { [key: string]: DriverData };
    ordersData: Order[];
    selectedOrderId?: number | null;
    onClearSelectedOrder?: () => void;
}

// Component con để fit bounds khi route thay đổi
const FitBounds = ({ positions }: { positions: [number, number][] }) => {
    const map = useMap();
    useEffect(() => {
        if (positions.length > 1) {
            const bounds = L.latLngBounds(positions);
            map.fitBounds(bounds, { padding: [60, 60] });
        }
    }, [positions, map]);
    return null;
};

const ROUTE_REFRESH_DISTANCE_METERS = 120;
const routeCache = new Map<string, { coordinates: [number, number][]; info: { distanceKm: string; durationMin: number } }>();

const toRadians = (value: number) => value * Math.PI / 180;

const distanceMeters = (a: [number, number], b: [number, number]) => {
    const earthRadius = 6371000;
    const dLat = toRadians(b[0] - a[0]);
    const dLng = toRadians(b[1] - a[1]);
    const lat1 = toRadians(a[0]);
    const lat2 = toRadians(b[0]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadius * Math.asin(Math.sqrt(h));
};

const LiveMap: React.FC<LiveMapProps> = ({ driversData, ordersData, selectedOrderId, onClearSelectedOrder }) => {
    const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
    const [isLoadingRoute, setIsLoadingRoute] = useState(false);
    const [routeInfo, setRouteInfo] = useState<{ distanceKm: string; durationMin: number } | null>(null);
    const activeFetchRef = useRef<AbortController | null>(null);
    const lastRouteRequestRef = useRef<{ orderId: number; from: [number, number]; to: [number, number] } | null>(null);

    const selectedOrder = useMemo(
        () => (selectedOrderId ? ordersData.find(o => o.id === selectedOrderId) : null),
        [selectedOrderId, ordersData]
    );

    const activeDriver = useMemo(() => {
        if (!selectedOrder?.driver_id) return null;
        return driversData[String(selectedOrder.driver_id)] ?? null;
    }, [selectedOrder, driversData]);

    const fetchRoute = useCallback(async (orderId: number, from: [number, number], to: [number, number]) => {
        const cacheKey = `${orderId}-${from[0].toFixed(3)}-${from[1].toFixed(3)}-${to[0].toFixed(4)}-${to[1].toFixed(4)}`;
        const cached = routeCache.get(cacheKey);
        if (cached) {
            setRouteCoordinates(cached.coordinates);
            setRouteInfo(cached.info);
            setIsLoadingRoute(false);
            return;
        }

        activeFetchRef.current?.abort();
        const controller = new AbortController();
        activeFetchRef.current = controller;

        setIsLoadingRoute(true);
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;

        try {
            const res = await fetch(osrmUrl, { signal: controller.signal });
            const data = await res.json();
            if (data.code === 'Ok' && data.routes?.length > 0) {
                const route = data.routes[0];
                const coordinates = route.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
                const info = {
                    distanceKm: (route.distance / 1000).toFixed(1),
                    durationMin: Math.max(1, Math.round(route.duration / 60))
                };
                routeCache.set(cacheKey, { coordinates, info });
                setRouteCoordinates(coordinates);
                setRouteInfo(info);
            } else {
                setRouteCoordinates([from, to]);
                setRouteInfo(null);
            }
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                console.error('[LiveMap] OSRM fetch error:', err);
                setRouteCoordinates([from, to]);
                setRouteInfo(null);
            }
        } finally {
            if (activeFetchRef.current === controller) {
                activeFetchRef.current = null;
                setIsLoadingRoute(false);
            }
        }
    }, []);

    useEffect(() => {
        if (!selectedOrderId || !selectedOrder || !['pickup', 'delivering'].includes(selectedOrder.status)) {
            setRouteCoordinates([]);
            setRouteInfo(null);
            lastRouteRequestRef.current = null;
            activeFetchRef.current?.abort();
            return;
        }

        if (!activeDriver) {
            setRouteCoordinates([]);
            setRouteInfo(null);
            lastRouteRequestRef.current = null;
            return;
        }

        const driverLat = Number(activeDriver.lat);
        const driverLng = Number(activeDriver.lng);
        const destLat = Number(selectedOrder.latitude);
        const destLng = Number(selectedOrder.longitude);
        if (![driverLat, driverLng, destLat, destLng].every(Number.isFinite)) return;

        const from: [number, number] = [driverLat, driverLng];
        const to: [number, number] = [destLat, destLng];
        const last = lastRouteRequestRef.current;
        if (
            last &&
            last.orderId === selectedOrderId &&
            distanceMeters(last.from, from) < ROUTE_REFRESH_DISTANCE_METERS &&
            distanceMeters(last.to, to) < 5
        ) {
            return;
        }

        lastRouteRequestRef.current = { orderId: selectedOrderId, from, to };
        fetchRoute(selectedOrderId, from, to);
    }, [selectedOrderId, selectedOrder, activeDriver, fetchRoute]);

    const activeOrderByDriverId = useMemo(() => {
        const map = new Map<string, Order>();
        ordersData.forEach((order) => {
            if (!order.driver_id || !['pickup', 'delivering'].includes(order.status)) return;
            const current = map.get(String(order.driver_id));
            if (!current || order.id > current.id) {
                map.set(String(order.driver_id), order);
            }
        });
        return map;
    }, [ordersData]);

    const driverMarkers = useMemo(() => {
        return Object.entries(driversData).map(([driverId, data]) => {
            const activeOrder = activeOrderByDriverId.get(driverId);
            const effectiveStatus = activeOrder?.status === 'delivering' ? 'delivering' : 'idle';

            return {
                driverId,
                position: [data.lat, data.lng] as [number, number],
                status: effectiveStatus,
                activeOrderId: activeOrder?.id ? String(activeOrder.id) : undefined,
                fullName: data.full_name,
                vehicleType: data.vehicle_type,
                licensePlate: data.license_plate
            };
        });
    }, [driversData, activeOrderByDriverId]);

    // Destination marker icon
    const destIcon = useMemo(() => L.divIcon({
        className: 'dest-marker',
        html: `<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4));">📍</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 26]
    }), []);

    return (
        <div className="h-full w-full relative">
            {/* Loading indicator */}
            {isLoadingRoute && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-slate-800/90 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Đang tải lộ trình...
                </div>
            )}

            {/* Route info card khi có đơn được chọn */}
            {selectedOrder && routeInfo && !isLoadingRoute && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-white shadow-xl rounded-xl px-5 py-3 flex items-center gap-4 border border-slate-200 min-w-[280px]">
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 text-sm truncate">#ORD-{selectedOrder.id} — {selectedOrder.customer_name}</p>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{selectedOrder.address}</p>
                        <div className="flex gap-3 mt-1.5">
                            <span className="text-xs font-semibold text-blue-600">📏 {routeInfo.distanceKm} km</span>
                            <span className="text-xs font-semibold text-emerald-600">⏱ {routeInfo.durationMin} phút</span>
                        </div>
                    </div>
                    {onClearSelectedOrder && (
                        <button
                            onClick={onClearSelectedOrder}
                            className="w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center flex-shrink-0 transition-colors"
                            title="Đóng lộ trình"
                        >
                            <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    )}
                </div>
            )}

            {/* Thông báo khi chọn đơn nhưng driver offline/chưa gán */}
            {selectedOrder && !activeDriver && ['pickup', 'delivering'].includes(selectedOrder.status) && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                    </svg>
                    Tài xế của đơn #ORD-{selectedOrder.id} hiện đang offline
                    {onClearSelectedOrder && (
                        <button onClick={onClearSelectedOrder} className="ml-1 font-semibold underline">Đóng</button>
                    )}
                </div>
            )}

            <MapContainer
                center={defaultCenter}
                zoom={13}
                className="z-0 rounded-lg shadow-sm"
                zoomControl={true}
                style={{ height: '100%', width: '100%' }}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* CHỈ hiển thị driver markers */}
                {driverMarkers.map(driver => (
                    <DriverMarker
                        key={driver.driverId}
                        driverId={driver.driverId}
                        position={driver.position}
                        status={driver.status}
                        activeOrderId={driver.activeOrderId}
                    />
                ))}

                {/* Marker đích khi có đơn được chọn */}
                {selectedOrder && (
                    <Marker
                        key={`dest-${selectedOrder.id}`}
                        position={[Number(selectedOrder.latitude), Number(selectedOrder.longitude)]}
                        icon={destIcon}
                    >
                        <Popup>
                            <div className="text-slate-800 min-w-[160px]">
                                <p className="font-bold text-sm">#ORD-{selectedOrder.id}</p>
                                <p className="text-xs text-slate-600 mt-1">{selectedOrder.customer_name}</p>
                                <p className="text-xs text-slate-500 mt-1 truncate">{selectedOrder.address}</p>
                            </div>
                        </Popup>
                    </Marker>
                )}

                {/* Polyline lộ trình OSRM */}
                {routeCoordinates.length > 1 && (
                    <>
                        <Polyline
                            positions={routeCoordinates}
                            pathOptions={{ color: '#3b82f6', weight: 6, opacity: 0.75, lineCap: 'round', lineJoin: 'round' }}
                        />
                        <FitBounds positions={routeCoordinates} />
                    </>
                )}
            </MapContainer>
        </div>
    );
};

export default LiveMap;
