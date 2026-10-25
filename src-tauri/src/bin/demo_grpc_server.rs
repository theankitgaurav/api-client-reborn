#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Starting demo gRPC servers...");
    println!("  - Port 50051: With Server Reflection enabled (UserService + ServerReflection v1)");
    println!("  - Port 50052: Without Server Reflection (UserService only, require .proto file)");

    let proto_candidates = [
        "examples/user.proto",
        "../examples/user.proto",
        "../../examples/user.proto",
    ];
    let proto_path = proto_candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .copied()
        .unwrap_or("examples/user.proto");

    println!("Using proto definitions from: {}", proto_path);

    api_client_reborn_lib::engine::demo_server::start_demo_grpc_services(50051, 50052, proto_path).await?;
    Ok(())
}
