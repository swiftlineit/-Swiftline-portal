import { Router } from "express";
import {
  changeProfilePassword,
  deleteProfileImage,
  getProfile,
  uploadProfileImage,
  viewProfileImage,
  updateProfileBusinessAccount,
  updateProfileDetails
} from "../controllers/profile.controller.js";
import { attachUser, requireAuthenticated } from "../middleware/auth.middleware.js";
import { profileImageUpload } from "../middleware/profileImageUpload.middleware.js";

// Every authenticated user owns a profile, so this router is not role gated:
// each handler scopes its work to the signed-in user. It is still gated on being
// signed in at all, because attachUser lets anonymous requests through.
export const profileRouter = Router();

profileRouter.use(attachUser, requireAuthenticated);
profileRouter.get("/", getProfile);
profileRouter.patch("/", updateProfileDetails);
profileRouter.get("/image", viewProfileImage);
profileRouter.post("/image", profileImageUpload, uploadProfileImage);
profileRouter.delete("/image", deleteProfileImage);
profileRouter.patch("/business-accounts/:accountId", updateProfileBusinessAccount);
profileRouter.post("/password", changeProfilePassword);
