import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import DriverMarker from './DriverMarker';

const defaultCenter: [number, number] = [10.762622, 106.660172];

interface DriverData {
    lat: number;
    lng: number;
    status: string;
    active_order_id?: string;
    full_name?: string;
    vehicle_type?: string;
    license_plate?: string;
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

// Debounce helper
function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState<T>(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

const LiveMap: React.FC<LiveMapProps> = ({ driversData, ordersData, selectedOrderId, onClearSelectedOrder }) => {
    const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
    const [isLoadingRoute, setIsLoadingRoute] = useState(false);
    const [routeInfo, setRouteInfo] = useState<{ distanceKm: string; durationMin: number } | null>(null);
    const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastFetchKeyRef = useRef<string>('');

    const selectedOrder = useMemo(
        () => (selectedOrderId ? ordersData.find(o => o.id === selectedOrderId) : null),
        [selectedOrderId, ordersData]
    );

    const activeDriver = useMemo(() => {
        if (!selectedOrder?.driver_id) return null;
        return driversData[String(selectedOrder.driver_id)] ?? null;
    }, [selectedOrder, driversData]);

    // Debounce driver location để tránh spam OSRM khi driver đang di chuyển
    const debouncedDriverLat = useDebouncedValue(activeDriver?.lat ?? null, 5000);
    const debouncedDriverLng = useDebouncedValue(activeDriver?.lng ?? null, 5000);

    // Fetch OSRM route: khi selectedOrderId thay đổi hoặc vị trí driver thay đổi (debounced)
    useEffect(() => {
        // Xóa route nếu không có đơn được chọn
        if (!selectedOrderId || !selectedOrder) {
            setRouteCoordinates([]);
            setRouteInfo(null);
            return;
        }

        // Chỉ hiển thị route cho đơn đang active
        if (!['pickup', 'delivering'].includes(selectedOrder.status)) {
            setRouteCoordinates([]);
            setRouteInfo(null);
            return;
        }

        // Cần có driver và vị trí hợp lệ
        if (!activeDriver || debouncedDriverLat === null || debouncedDriverLng === null) {
            setRouteCoordinates([]);
            setRouteInfo(null);
            return;
        }

        const destLat = Number(selectedOrder.latitude);
        const destLng = Number(selectedOrder.longitude);
        if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return;

        // Tạo key để tránh fetch trùng
        const fetchKey = `${selectedOrderId}-${debouncedDriverLat.toFixed(4)}-${debouncedDriverLng.toFixed(4)}-${destLat.toFixed(4)}-${destLng.toFixed(4)}`;
        if (fetchKey === lastFetchKeyRef.current) return;
        lastFetchKeyRef.current = fetchKey;

        if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);

        setIsLoadingRoute(true);
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${debouncedDriverLng},${debouncedDriverLat};${destLng},${destLat}?overview=full&geometries=geojson`;

        fetch(osrmUrl)
            .then(res => res.json())
            .then(data => {
                if (data.code === 'Ok' && data.routes?.length > 0) {
                    const route = data.routes[0];
                    const coords = route.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
                    setRouteCoordinates(coords);
                    setRouteInfo({
                        distanceKm: (route.distance / 1000).toFixed(1),
                        durationMin: Math.max(1, Math.round(route.duration / 60))
                    });
                } else {
                    setRouteCoordinates([]);
                    setRouteInfo(null);
                }
            })
            .catch(err => {
                console.error('[LiveMap] OSRM fetch error:', err);
                setRouteCoordinates([]);
                setRouteInfo(null);
            })
            .finally(() => setIsLoadingRoute(false));

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedOrderId, debouncedDriverLat, debouncedDriverLng]);

    const driverMarkers = useMemo(() => {
        return Object.entries(driversData).map(([driverId, data]) => ({
            driverId,
            position: [data.lat, data.lng] as [number, number],
            status: data.status,
            activeOrderId: data.active_order_id,
            fullName: data.full_name,
            vehicleType: data.vehicle_type,
            licensePlate: data.license_plate
        }));
    }, [driversData]);

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
