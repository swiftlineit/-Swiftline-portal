import { Router } from "express";
import {
  changeProfilePassword,
  getProfile,
  updateProfileBusinessAccount,
  updateProfileDetails
} from "../controllers/profile.controller.js";
import { attachUser } from "../middleware/auth.middleware.js";

// Every authenticated user owns a profile, so this router is not role gated:
// each handler scopes its work to the signed-in user.
export const profileRouter = Router();

profileRouter.use(attachUser);
profileRouter.get("/", getProfile);
profileRouter.patch("/", updateProfileDetails);
profileRouter.patch("/business-accounts/:accountId", updateProfileBusinessAccount);
profileRouter.post("/password", changeProfilePassword);
