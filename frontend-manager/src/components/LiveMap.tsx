import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine';
import DriverMarker from './DriverMarker';

const defaultCenter = { lat: 10.762622, lng: 106.660172 };

interface LiveMapProps {
    driversData: { [key: string]: { lat: number, lng: number, status: string, active_order_id?: string } };
    ordersData: any[];
}

interface RoutePoint {
    lat: number;
    lng: number;
    orderId?: number;
}

const RoutingControl = ({ origin, destination }: { origin: L.LatLngExpression; destination: L.LatLngExpression }) => {
    const map = useMap();

    useEffect(() => {
        if (!map) return;

        const routingControl = (L as any).Routing.control({
            waypoints: [L.latLng(origin), L.latLng(destination)],
            routeWhileDragging: false,
            addWaypoints: false,
            // Bỏ `language: 'vi'` vì leaflet-routing-machine không có localization cho tiếng Việt
            // (mặc định là 'en' — đã được bundle sẵn trong plugin)
            showAlternatives: false,
            lineOptions: {
                styles: [{ color: '#3b82f6', opacity: 0.6, weight: 5 }]
            }
        });

        routingControl.addTo(map);

        return () => {
            try { map.removeControl(routingControl); } catch {}
        };
    }, [map, origin, destination]);

    return null;
};

const LiveMap: React.FC<LiveMapProps> = ({ driversData, ordersData }) => {
    const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
    const [routingDestination, setRoutingDestination] = useState<L.LatLngExpression | null>(null);

    const activeDriverRoute = useMemo(() => {
        const activeDriverId = Object.keys(driversData).find(id => driversData[id].status === 'delivering');
        if (!activeDriverId) return null;

        const driver = driversData[activeDriverId];
        const assignedOrder = ordersData.find(o => o.id.toString() === String(driver.active_order_id));
        if (!assignedOrder) return null;

        return {
            driverId: activeDriverId,
            order: assignedOrder,
            origin: [driver.lat, driver.lng] as L.LatLngExpression
        };
    }, [driversData, ordersData]);

    // Key cố định để map không bị destroy/recreate khi data thay đổi
    const mapKey = 'live-map';

    useEffect(() => {
        if (!activeDriverRoute) {
            setRoutingDestination(null);
            setRoutePoints([]);
            return;
        }

        setRoutePoints(prev => {
            const origin = activeDriverRoute.origin;
            const originLat = Array.isArray(origin) ? (origin as any)[0] : (origin as any).lat;
            const originLng = Array.isArray(origin) ? (origin as any)[1] : (origin as any).lng;
            const next = [...prev, { lat: originLat, lng: originLng }];
            return next.slice(-50);
        });
        setRoutingDestination({ lat: activeDriverRoute.order.latitude, lng: activeDriverRoute.order.longitude });
    }, [activeDriverRoute]);

    const driverMarkers = useMemo(() => {
        return Object.keys(driversData).map(driverId => {
            const data = driversData[driverId];
            return {
                driverId,
                position: [data.lat, data.lng] as L.LatLngExpression,
                status: data.status,
                activeOrderId: data.active_order_id
            };
        });
    }, [driversData]);

    const orderMarkers = useMemo(() => {
        return ordersData.map(order => ({
            id: order.id,
            position: [Number(order.latitude), Number(order.longitude)] as L.LatLngExpression,
            status: order.status,
            customerName: order.customer_name,
            address: order.address
        }));
    }, [ordersData]);

    const polylinePositions = useMemo(() => {
        if (!activeDriverRoute) return [];
        return routePoints.map(point => [point.lat, point.lng] as L.LatLngExpression);
    }, [routePoints, activeDriverRoute]);

    return (
        <MapContainer
            key={mapKey}
            center={defaultCenter}
            zoom={13}
            className="z-0 rounded-lg shadow-sm"
            zoomControl={true}
            style={{ height: '100%', width: '100%', minHeight: '500px' }}
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {driverMarkers.map(driver => (
                <DriverMarker
                    key={driver.driverId}
                    driverId={driver.driverId}
                    position={driver.position}
                    status={driver.status}
                    activeOrderId={driver.activeOrderId}
                />
            ))}

            {orderMarkers.map(order => (
                <Marker key={`order-${order.id}`} position={order.position}>
                    <Popup>
                        <div className="text-slate-800">
                            <p className="font-bold text-sm">#ORD-{order.id}</p>
                            <p className="text-xs text-slate-600 mt-1">{order.customerName}</p>
                            <p className="text-xs text-slate-500 mt-1">{order.address}</p>
                            <span className={`inline-block mt-2 px-2 py-1 text-[11px] font-bold rounded-full ${
                                order.status === 'pending' ? 'bg-slate-100 text-slate-600' :
                                order.status === 'pickup' ? 'bg-blue-100 text-blue-700' :
                                order.status === 'delivering' ? 'bg-amber-100 text-amber-700' :
                                order.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                'bg-red-100 text-red-700'
                            }`}>
                                {order.status}
                            </span>
                        </div>
                    </Popup>
                </Marker>
            ))}

            {routingDestination && activeDriverRoute && (
                <RoutingControl origin={activeDriverRoute.origin} destination={routingDestination} />
            )}

            {polylinePositions.length > 1 && (
                <Polyline
                    positions={polylinePositions}
                    pathOptions={{ color: '#3b82f6', weight: 5, opacity: 0.6 }}
                />
            )}
        </MapContainer>
    );
};

export default LiveMap;
