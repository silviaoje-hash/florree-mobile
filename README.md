# Florree Herbals Mobile App

A React Native (Expo) mobile app for the Florree Herbals shop: https://florree-herbals.vercel.app

## Features
- Same account on the website and the app (Supabase Auth, email and password)
- Same backend as the website: the app reads products from the same Supabase database
- Cart sync both ways: the cart is stored in the `cart_items` table and updates instantly with Supabase Realtime (plus a 5-second refresh as backup)
- Checkout opens the website checkout

## Run locally
1. `npm install`
2. Create a `.env` file with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public keys only)
3. `npx expo start` and scan the QR code with Expo Go

## Build the APK
`eas build -p android --profile preview`