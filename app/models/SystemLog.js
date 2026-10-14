import { Model } from "../../core/model.js";

export class SystemLog extends Model {
  static table = "system_logs";
  static timestamps = false;
  static fillable = ["level", "message", "context", "user_id", "created_at"];
}
