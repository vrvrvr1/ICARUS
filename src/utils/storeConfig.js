// Central config for the store/warehouse location.
// You can override via environment variables: STORE_LAT, STORE_LNG, STORE_NAME, STORE_ADDRESS

const lat = process.env.STORE_LAT ? Number(process.env.STORE_LAT) : 14.5995; // Manila default
const lng = process.env.STORE_LNG ? Number(process.env.STORE_LNG) : 120.9842;

const storeConfig = {
  lat,
  lng,
  name: process.env.STORE_NAME || 'Icarus Store',
  address: process.env.STORE_ADDRESS || 'Manila, Philippines',
};

export default storeConfig;