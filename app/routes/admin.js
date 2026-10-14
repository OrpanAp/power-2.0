import { auth } from "../auth.js";
import { AdminController as A } from "../controllers/AdminController.js";

export function adminRoutes(app) {
  app.group("/admin", [auth.requireRole("admin"), auth.require2fa], (r) => {
    r.get("/", A.dashboard);
    r.get("/health.json", A.healthJson);

    r.get("/users", A.usersIndex);
    r.get("/users/new", A.usersCreate);
    r.post("/users", A.usersStore);
    r.get("/users/:id/edit", A.usersEdit);
    r.put("/users/:id", A.usersUpdate);
    r.delete("/users/:id", A.usersDestroy);

    r.get("/tables", A.tablesIndex);
    r.get("/tables/:name", A.tableShow);
    r.delete("/tables/:name/rows/:rid", A.tableRowDestroy);

    r.get("/logs", A.logs);
    r.post("/logs/purge", A.logsPurge);
  });
}
