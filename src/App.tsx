import PlanetaryScene from "./three/Scene";
import Hud from "./ui/hud";

export default function App() {
  return (
    <div className="relative w-full h-full overflow-hidden bg-void select-none">
      <PlanetaryScene />
      <Hud />
    </div>
  );
}
