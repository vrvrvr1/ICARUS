// paypal.js
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

export async function generateAccessToken() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_SECRET;

    const auth = Buffer.from(clientId + ":" + secret).toString("base64");

    try {
        const response = await axios({
            url: process.env.PAYPAL_BASE_URL + "/v1/oauth2/token",
            method: "post",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data: "grant_type=client_credentials",
        });

        return response.data.access_token;
    } catch (err) {
        console.error(err);
        return null;
    }
}
