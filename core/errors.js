export class HttpError extends Error {
  constructor(status = 500, message = "Internal Server Error", details = null) {
    super(message);
    this.status = status;
    this.expose = status < 500;
    this.details = details;
  }
}
export const abort = (status, message, details) => {
  throw new HttpError(status, message, details);
};
