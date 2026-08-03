import { Router } from "express";
import { listCities, listStates } from "../controllers/reference.controller.js";
import { attachUser, requireAuthenticated } from "../middleware/auth.middleware.js";

export const referenceRouter = Router();

referenceRouter.use(attachUser);
// Geography is public reference data, but every form that needs it sits behind
// a login, so there is no reason to serve it anonymously.
referenceRouter.use(requireAuthenticated);

referenceRouter.get("/countries/:countryCode/states", listStates);
referenceRouter.get("/countries/:countryCode/states/:stateCode/cities", listCities);
