declare module 'smart-http-request' {
  export class SmartHttpRequest {
    constructor(...args: any[]);
    request(...args: any[]): any;
  }
}

declare module 'smart-http-request/adapters/fetch.js' {
  export class SmartHttpRequestFetchAdapter {}
}
