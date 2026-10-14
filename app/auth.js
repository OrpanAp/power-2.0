import { createAuth } from "../core/auth.js";
import { User } from "./models/User.js";

export const auth = createAuth(User);
