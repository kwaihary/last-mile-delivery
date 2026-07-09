import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

export const sendTrackingSms = async (to: string, trackingUrl: string, orderId: number) => {
  if (!accountSid || !authToken || !fromNumber) {
    console.warn('Twilio chưa được cấu hình đầy đủ, bỏ qua gửi SMS.');
    return null;
  }

  const client = twilio(accountSid, authToken);

  const message = await client.messages.create({
    to,
    from: fromNumber,
    body: `Đơn hàng #ORD-${orderId} đang được giao. Theo dõi tài xế: ${trackingUrl}`
  });

  return message;
};
