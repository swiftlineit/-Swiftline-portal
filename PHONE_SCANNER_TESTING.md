# Phone Manifest Scanner Testing

The phone scanner needs HTTPS for camera access. During development, the frontend
and backend can remain on the local computer and be exposed through temporary
VS Code development tunnels.

## Local services

Start the backend and frontend:

```powershell
cd portal/backend
npm run dev
```

```powershell
cd portal/frontend
npm run dev
```

The normal ports are:

- Frontend: `3000`
- Backend: `5000`

If Next.js selects another port, use that actual port in the steps below.

## Forward the ports

1. Open the VS Code **Ports** view.
2. Forward the frontend port and backend port.
3. Set the backend port to **Public**. Browser CORS preflight requests cannot
   pass through the private tunnel's interactive sign-in page.
4. Keep the frontend private if the phone is signed into the tunnel provider,
   or make it public temporarily for a simpler scanner test.
5. Copy both generated HTTPS URLs.
6. Do not forward MongoDB, Redis, or any database-management port.

If private tunnel authentication is enabled for the frontend, open its
forwarded URL on the phone once and complete the tunnel sign-in before testing
the scanner.

VS Code port forwarding documentation:

https://code.visualstudio.com/docs/debugtest/port-forwarding

## Configure the temporary URLs

Set the backend `.env` value to the forwarded frontend URL:

```env
CLIENT_URL=https://your-frontend-tunnel.example
CORS_ORIGINS=http://localhost:3000
```

`CLIENT_URL` is the primary phone-facing frontend address. `CORS_ORIGINS` is a
comma-separated list of additional trusted frontend origins. Including the
local frontend lets the laptop keep using `http://localhost:3000` while the
phone uses the forwarded HTTPS address.

Set the frontend `.env.local` value to the forwarded backend URL:

```env
NEXT_PUBLIC_API_URL=https://your-backend-tunnel.example
```

Restart both development servers after changing either value. The backend uses
`CLIENT_URL` when it creates the pairing QR, and the frontend embeds
`NEXT_PUBLIC_API_URL` at build/dev-server startup.

Never hardcode a temporary tunnel URL in source control. Update the environment
values whenever the tunnel URLs change.

## Test the scanner

1. On the laptop, sign in as Admin or Operations.
2. Open an editable operations manifest.
3. Create or select an open bag.
4. Select **Connect Phone**.
5. Scan the displayed QR using the phone's normal camera.
6. Open the Swiftline link and sign in if requested.
7. Select **Start Camera**.
8. Point the rear camera at the Code 128 barcode printed on the parcel label.
9. Confirm the accepted or rejected result appears on both devices.
10. Close the bag on the laptop and confirm the phone waits for another open bag.

For the first physical run, scan ten parcels continuously. Then run fifty
parcels to validate camera focus, lighting, duplicate suppression, and operator
comfort.
