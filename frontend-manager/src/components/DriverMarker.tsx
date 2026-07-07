import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { useInterpolation } from '../hooks/useInterpolation';

interface DriverMarkerProps {
    driverId: string;
    position: L.LatLngExpression;
    status: string;
    activeOrderId?: string;
}

const driverIconByStatus = (status: string) => {
    const emoji = status === 'delivering' ? '🛵' : '🛸';
    return L.divIcon({
        className: 'driver-marker',
        html: `<div style="font-size:28px;line-height:1;filter:drop-shadow(0 2px 2px rgba(0,0,0,0.3));">${emoji}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });
};

const DriverMarker: React.FC<DriverMarkerProps> = ({ driverId, position, status, activeOrderId }) => {
    // Leaflet LatLngExpression có thể là tuple [lat, lng] hoặc LatLng object.
    // useInterpolation yêu cầu Coordinate — chuẩn hóa về { lat, lng }
    const targetCoord: { lat: number; lng: number } = Array.isArray(position)
        ? { lat: (position as any)[0], lng: (position as any)[1] }
        : { lat: (position as any).lat, lng: (position as any).lng };

    const smoothLocation = useInterpolation(targetCoord, 10000);
    const positionTuple: [number, number] = [smoothLocation.lat, smoothLocation.lng];

    const statusText = status === 'delivering' ? 'Đang giao' : status === 'idle' ? 'Rảnh' : status;

    return (
        <Marker position={positionTuple} icon={driverIconByStatus(status)}>
            <Popup>
                <div className="text-slate-800">
                    <p className="font-bold text-sm">Tài xế #{driverId}</p>
                    <p className="text-xs text-slate-600 mt-1">Trạng thái: {statusText}</p>
                    {activeOrderId ? <p className="text-xs text-slate-500 mt-1">Đơn #{activeOrderId}</p> : null}
                </div>
            </Popup>
        </Marker>
    );
};

export default DriverMarker;
