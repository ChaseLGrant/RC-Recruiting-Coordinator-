declare module "zipcodes" {
  interface ZipInfo {
    zip: string;
    latitude: number;
    longitude: number;
    city: string;
    state: string;
    country: string;
  }
  const zipcodes: {
    lookup(zip: string | number): ZipInfo | undefined;
    lookupByName(city: string, state: string): ZipInfo[];
    lookupByState(state: string): ZipInfo[];
    distance(a: string, b: string): number | null;
    radius(zip: string, miles: number): string[];
  };
  export default zipcodes;
}
