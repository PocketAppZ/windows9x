import {
  Drive,
  StubFile,
  DeepFile,
  DeepFolder,
  ShallowFolder,
  Depth,
} from "./Drive";
import { RealFs } from "./RealFs";
import { atomWithRefresh } from "jotai/utils";
import {
  SYSTEM_PATH,
  PROGRAMS_PATH,
  USER_PATH,
  REGISTRY_PATH,
} from "@/lib/filesystem/defaultFileSystem";

export class FsManager {
  private rootDrive: Drive;
  private mountedDrives: { [name: string]: Drive } = {};

  private shallowAtoms: {
    [path: string]: ReturnType<
      typeof atomWithRefresh<Promise<ShallowFolder | null>>
    >;
  } = {};

  private deepAtoms: {
    [path: string]: ReturnType<
      typeof atomWithRefresh<Promise<DeepFolder | null>>
    >;
  } = {};

  private fileAtoms: {
    [path: string]: ReturnType<
      typeof atomWithRefresh<Promise<DeepFile | null>>
    >;
  } = {};

  constructor(
    rootHandle: FileSystemDirectoryHandle,
    mountedDrives: { [name: string]: FileSystemDirectoryHandle } = {}
  ) {
    this.rootDrive = new Drive(new RealFs(rootHandle));

    // Mount drives passed in the constructor
    for (const [name, handle] of Object.entries(mountedDrives)) {
      this.mountedDrives[name] = new Drive(new RealFs(handle));
    }

    this.setupDefaultDirectories();
  }

  public async setupDefaultDirectories(): Promise<void> {
    const defaultDirs = [SYSTEM_PATH, PROGRAMS_PATH, USER_PATH];
    for (const dir of defaultDirs) {
      const exists = await this.getFolder(dir, "shallow");
      if (!exists) {
        await this.createFolder(dir);
      }
    }

    // Create registry file if it doesn't exist
    const registryExists = await this.getFile(REGISTRY_PATH, "shallow");
    if (!registryExists) {
      await this.writeFile(REGISTRY_PATH, "{}");
    }
  }

  public async hasSystemData(): Promise<boolean> {
    const system = await this.getFolder(SYSTEM_PATH, "shallow");
    return !!system;
  }

  async writeFile(path: string, content: string | ArrayBuffer): Promise<void> {
    const mountedDrive = this.getMountedDriveForPath(path);
    if (mountedDrive) {
      const relativePath = this.getRelativePath(path);
      return mountedDrive.writeFile(relativePath, content);
    }
    return this.rootDrive.writeFile(path, content);
  }

  async createFolder(path: string): Promise<void> {
    const mountedDrive = this.getMountedDriveForPath(path);
    if (mountedDrive) {
      const relativePath = this.getRelativePath(path);
      return mountedDrive.createFolder(relativePath);
    }
    return this.rootDrive.createFolder(path);
  }

  async delete(path: string): Promise<void> {
    const mountedDrive = this.getMountedDriveForPath(path);
    if (mountedDrive) {
      const relativePath = this.getRelativePath(path);
      return mountedDrive.delete(relativePath);
    }
    return this.rootDrive.delete(path);
  }

  async getItem(
    path: string,
    depth: "shallow"
  ): Promise<StubFile | ShallowFolder | null>;
  async getItem(
    path: string,
    depth: "deep"
  ): Promise<DeepFile | DeepFolder | null>;
  async getItem(
    path: string,
    depth: Depth = "shallow"
  ): Promise<StubFile | ShallowFolder | DeepFile | DeepFolder | null> {
    const mountedDrive = this.getMountedDriveForPath(path);
    if (mountedDrive) {
      const relativePath = this.getRelativePath(path);
      return mountedDrive.getItem(relativePath, depth as any);
    }

    return this.rootDrive.getItem(path, depth as any);
  }

  async getFolder(
    path: string,
    depth: "shallow"
  ): Promise<ShallowFolder | null>;
  async getFolder(path: string, depth: "deep"): Promise<DeepFolder | null>;
  async getFolder(
    path: string,
    depth: Depth = "shallow"
  ): Promise<ShallowFolder | DeepFolder | null> {
    if (path === "/") {
      // Handle root directory
      const rootFolder = await this.rootDrive.getFolder(path, depth as any);
      if (rootFolder && Object.keys(this.mountedDrives).length > 0) {
        // Add "mnt" folder to the root directory
        const mntFolder: ShallowFolder | DeepFolder = {
          type: "folder",
          name: "mnt",
          items: {},
        };

        if (depth === "deep") {
          for (const [name, drive] of Object.entries(this.mountedDrives)) {
            mntFolder.items[name] = (await drive.getFolder("/", "deep"))!;
          }
        } else {
          mntFolder.items = Object.fromEntries(
            Object.keys(this.mountedDrives).map((name) => [
              name,
              {
                type: "folder" as const,
                name,
              },
            ])
          );
        }

        rootFolder.items["mnt"] = mntFolder;
      }
      return rootFolder;
    }

    const mountedDrive = this.getMountedDriveForPath(path);
    if (mountedDrive) {
      const relativePath = this.getRelativePath(path);
      return mountedDrive.getFolder(relativePath, depth as any);
    }
    return this.rootDrive.getFolder(path, depth as any);
  }

  async getFile(path: string, depth: "shallow"): Promise<StubFile | null>;
  async getFile(path: string, depth: "deep"): Promise<DeepFile | null>;
  async getFile(
    path: string,
    depth: Depth = "shallow"
  ): Promise<StubFile | DeepFile | null> {
    const mountedDrive = this.getMountedDriveForPath(path);
    if (mountedDrive) {
      const relativePath = this.getRelativePath(path);
      return mountedDrive.getFile(relativePath, depth as any);
    }
    return this.rootDrive.getFile(path, depth as any);
  }

  async insert(path: string, item: DeepFolder | DeepFile): Promise<void> {
    const mountedDrive = this.getMountedDriveForPath(path);
    if (mountedDrive) {
      const relativePath = this.getRelativePath(path);
      return mountedDrive.insert(relativePath, item);
    }
    return this.rootDrive.insert(path, item);
  }

  async move(oldPath: string, newPath: string): Promise<void> {
    const mountedDrive = this.getMountedDriveForPath(oldPath);
    if (mountedDrive) {
      const relativeOldPath = this.getRelativePath(oldPath);
      const relativeNewPath = this.getRelativePath(newPath);
      return mountedDrive.move(relativeOldPath, relativeNewPath);
    }
    return this.rootDrive.move(oldPath, newPath);
  }

  getFolderAtom(
    path: string,
    depth: "shallow"
  ): ReturnType<typeof atomWithRefresh<Promise<ShallowFolder | null>>>;
  getFolderAtom(
    path: string,
    depth: "deep"
  ): ReturnType<typeof atomWithRefresh<Promise<DeepFolder | null>>>;
  getFolderAtom(
    path: string,
    depth: Depth = "shallow"
  ): ReturnType<
    typeof atomWithRefresh<Promise<ShallowFolder | DeepFolder | null>>
  > {
    const atomsMap = depth === "shallow" ? this.shallowAtoms : this.deepAtoms;

    if (!atomsMap[path]) {
      const atom = atomWithRefresh(async (_get) => {
        return await this.getFolder(path, depth as any);
      });
      atom.onMount = (set) => {
        const interval = setInterval(() => {
          set();
        }, 500);
        return () => {
          clearInterval(interval);
          delete atomsMap[path];
        };
      };
      atomsMap[path] = atom;
    }
    return atomsMap[path];
  }

  getFileAtom(
    path: string
  ): ReturnType<typeof atomWithRefresh<Promise<DeepFile | null>>> {
    if (!this.fileAtoms[path]) {
      const atom = atomWithRefresh(async (_get) => {
        return await this.getFile(path, "deep");
      });
      atom.onMount = (set) => {
        const interval = setInterval(() => {
          set();
        }, 500);
        return () => {
          clearInterval(interval);
          delete this.fileAtoms[path];
        };
      };
      this.fileAtoms[path] = atom;
    }
    return this.fileAtoms[path];
  }

  private getMountedDriveForPath(path: string): Drive | null {
    const parts = path.split("/");
    if (parts[1] === "mnt" && parts[2]) {
      return this.mountedDrives[parts[2]] || null;
    }
    return null;
  }

  private getRelativePath(path: string): string {
    const parts = path.split("/");
    return "/" + parts.slice(3).join("/");
  }
}
