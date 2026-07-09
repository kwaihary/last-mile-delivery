const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

export const getCoordinatesFromAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    const url = `${NOMINATIM_BASE_URL}/search?q=${encodeURIComponent(address)}&format=json&limit=1`;

    const response = await fetch(url, {
        headers: {
            'Accept-Language': 'vi',
            'User-Agent': 'DoAnTotNghiep_GiaoHang/1.0'
        }
    });

    if (!response.ok) {
        throw new Error('Geocoding failed');
    }

    const data = await response.json();

    if (!data || data.length === 0) {
        return null;
    }

    return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon)
    };
};

export const buildMapTileUrl = () => 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_DEFAULT_CENTER = { lat: 10.762622, lng: 106.660172 };
