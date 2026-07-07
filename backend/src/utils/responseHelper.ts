import { Response } from 'express'

export const sendResponse = (res: Response, statusCode: number, data: any = null, message: string = '', error: string = '') => {
    switch(statusCode){
        case 200:
            return res.status(200).json({ success: true, data: data })
        case 201:
            return res.status(201).json({ success: true, data: data, message: message || 'Created successfully' });
        case 400:
            return res.status(400).json({ success: false, error: error || "Bad Request" });
        case 401:
            return res.status(401).json({ success: false, error: error || "Unauthorized" });
        case 403:
            return res.status(403).json({ success: false, error: error || "Forbidden" });
        case 404:
            return res.status(404).json({ success: false, error: error || "Resource with specified ID not found" });
        case 500:
            return res.status(500).json({ success: false, error: error || "Internal Server Error" });
        default:
            return res.status(statusCode).json({ success: false, error: error || "An error occurred" });
    }
}