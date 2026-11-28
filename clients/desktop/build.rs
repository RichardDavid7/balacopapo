fn main() {
    println!("cargo:rerun-if-changed=icons/snafuonda.ico");

    #[cfg(target_os = "windows")]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("icons/snafuonda.ico");
        if let Err(err) = res.compile() {
            println!("cargo:warning=Falha ao embutir ícone snafuonda.ico: {err}");
        }
    }
}
