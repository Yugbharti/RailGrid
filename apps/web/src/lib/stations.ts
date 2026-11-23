export interface Station {
  code: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

export const STATIONS: Station[] = [
  { code: 'NDLS', name: 'New Delhi', city: 'Delhi', lat: 28.643, lng: 77.219 },
  { code: 'CNB', name: 'Kanpur Central', city: 'Kanpur', lat: 26.453, lng: 80.352 },
  { code: 'LKO', name: 'Lucknow Charbagh', city: 'Lucknow', lat: 26.832, lng: 80.925 },
  { code: 'PRYJ', name: 'Prayagraj Junction', city: 'Prayagraj', lat: 25.436, lng: 81.847 },
  { code: 'BSB', name: 'Varanasi Junction', city: 'Varanasi', lat: 25.317, lng: 82.974 },
  { code: 'HWH', name: 'Howrah Junction', city: 'Kolkata', lat: 22.583, lng: 88.342 },
  { code: 'GAYA', name: 'Gaya Junction', city: 'Gaya', lat: 24.796, lng: 84.999 },
  { code: 'BPL', name: 'Bhopal Junction', city: 'Bhopal', lat: 23.268, lng: 77.413 },
  { code: 'NGP', name: 'Nagpur Junction', city: 'Nagpur', lat: 21.151, lng: 79.088 },
  { code: 'CSTM', name: 'Mumbai CSMT', city: 'Mumbai', lat: 18.94, lng: 72.835 },
  { code: 'PUNE', name: 'Pune Junction', city: 'Pune', lat: 18.528, lng: 73.874 },
  { code: 'ADI', name: 'Ahmedabad Junction', city: 'Ahmedabad', lat: 23.027, lng: 72.601 },
  { code: 'JP', name: 'Jaipur Junction', city: 'Jaipur', lat: 26.92, lng: 75.788 },
  { code: 'AGC', name: 'Agra Cantt', city: 'Agra', lat: 27.158, lng: 77.991 },
  { code: 'MAS', name: 'Chennai Central', city: 'Chennai', lat: 13.083, lng: 80.275 },
  { code: 'BNC', name: 'Bengaluru Cantt', city: 'Bengaluru', lat: 12.991, lng: 77.598 },
  { code: 'SBC', name: 'KSR Bengaluru', city: 'Bengaluru', lat: 12.978, lng: 77.569 },
  { code: 'HYB', name: 'Hyderabad Deccan', city: 'Hyderabad', lat: 17.385, lng: 78.487 },
  { code: 'VSKP', name: 'Visakhapatnam', city: 'Visakhapatnam', lat: 17.686, lng: 83.218 },
  { code: 'TVC', name: 'Thiruvananthapuram Central', city: 'Thiruvananthapuram', lat: 8.487, lng: 76.953 },
  { code: 'ERS', name: 'Ernakulam Junction', city: 'Kochi', lat: 9.969, lng: 76.291 },
  { code: 'ASR', name: 'Amritsar Junction', city: 'Amritsar', lat: 31.633, lng: 74.872 },
  { code: 'JAT', name: 'Jammu Tawi', city: 'Jammu', lat: 32.706, lng: 74.879 },
];

export function findStation(query: string): Station[] {
  const q = query.trim().toUpperCase();
  if (!q) return STATIONS.slice(0, 8);
  return STATIONS.filter(
    (s) =>
      s.code.includes(q) ||
      s.name.toUpperCase().includes(q) ||
      s.city.toUpperCase().includes(q),
  ).slice(0, 8);
}
