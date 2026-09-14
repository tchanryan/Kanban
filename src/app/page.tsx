import DenseAppBar from "../components/materialUI/headerBar";
import ProjectArea from "../components/projectArea/projectArea";

export default function Home() {
  return (
    <div>
      <DenseAppBar />
      <div>
        <ProjectArea />
      </div>
    </div>
  );
}
