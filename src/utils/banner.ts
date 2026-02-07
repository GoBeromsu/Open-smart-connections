interface BannerPackageMeta {
  name: string;
  version: string;
  author: string;
}

export function create_banner(pkg: BannerPackageMeta): string {
  const year = new Date().getFullYear();
  return `/*! ${pkg.name} v${pkg.version} | (c) ${year} ${pkg.author} */`;
}
