import { PanelSection, PanelSectionRow, staticClasses } from "@decky/ui";
import { definePlugin } from "@decky/api";
import { FaLink } from "react-icons/fa";

// Placeholder panel; the overview, Check now and the link cards come in phase 4 task T6.
function Content() {
  return (
    <PanelSection>
      <PanelSectionRow>SaveTether</PanelSectionRow>
    </PanelSection>
  );
}

export default definePlugin(() => ({
  name: "SaveTether",
  titleView: <div className={staticClasses.Title}>SaveTether</div>,
  content: <Content />,
  icon: <FaLink />,
}));
