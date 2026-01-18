//! Links Queue CLI - Command-line interface for the queue server.
//!
//! This binary provides a CLI for starting the queue server and performing
//! queue operations.

use std::env;
use std::sync::Arc;

use links_queue::{BackendConfig, MemoryQueueManager, Router, ServerConfig};

#[tokio::main]
async fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        return;
    }

    match args[1].as_str() {
        "server" => run_server(&args[2..]).await,
        "version" | "-v" | "--version" => print_version(),
        "help" | "-h" | "--help" => print_usage(),
        _ => {
            eprintln!("Unknown command: {}", args[1]);
            print_usage();
        }
    }
}

fn print_version() {
    println!("links-queue v{}", links_queue::VERSION);
}

fn print_usage() {
    println!("links-queue v{}", links_queue::VERSION);
    println!();
    println!("Usage: links-queue <command> [options]");
    println!();
    println!("Commands:");
    println!("  server     Start the queue server");
    println!("  version    Show version information");
    println!("  help       Show this help message");
    println!();
    println!("Server Options:");
    println!("  --host <addr>     Host address to bind (default: 0.0.0.0)");
    println!("  --port <port>     Port to listen on (default: 5000)");
    println!("  --max-conn <n>    Maximum connections (default: 1000)");
    println!();
    println!("Examples:");
    println!("  links-queue server");
    println!("  links-queue server --port 8080");
    println!("  links-queue server --host 127.0.0.1 --port 5000");
}

async fn run_server(args: &[String]) {
    // Parse server arguments
    let mut host = "0.0.0.0".to_string();
    let mut port: u16 = 5000;
    let mut max_connections: usize = 1000;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--host" => {
                if i + 1 < args.len() {
                    host = args[i + 1].clone();
                    i += 2;
                } else {
                    eprintln!("Error: --host requires a value");
                    return;
                }
            }
            "--port" => {
                if i + 1 < args.len() {
                    match args[i + 1].parse() {
                        Ok(p) => port = p,
                        Err(_) => {
                            eprintln!("Error: Invalid port number");
                            return;
                        }
                    }
                    i += 2;
                } else {
                    eprintln!("Error: --port requires a value");
                    return;
                }
            }
            "--max-conn" => {
                if i + 1 < args.len() {
                    match args[i + 1].parse() {
                        Ok(m) => max_connections = m,
                        Err(_) => {
                            eprintln!("Error: Invalid max connections");
                            return;
                        }
                    }
                    i += 2;
                } else {
                    eprintln!("Error: --max-conn requires a value");
                    return;
                }
            }
            _ => {
                eprintln!("Unknown option: {}", args[i]);
                return;
            }
        }
    }

    // Create server configuration
    let config = ServerConfig::new(host.clone(), port)
        .with_backend(BackendConfig::memory())
        .with_max_connections(max_connections);

    println!("links-queue v{}", links_queue::VERSION);
    println!();
    println!("Starting server on {host}:{port}...");
    println!("Max connections: {max_connections}");
    println!();

    // Create queue manager
    let manager = Arc::new(MemoryQueueManager::<u64>::new());

    // Create router
    let router = Arc::new(Router::new(manager.clone()));

    // Start TCP listener
    let listener = match tokio::net::TcpListener::bind(config.bind_address()).await {
        Ok(l) => l,
        Err(e) => {
            let addr = config.bind_address();
            eprintln!("Failed to bind to {addr}: {e}");
            return;
        }
    };

    let bind_addr = config.bind_address();
    println!("Server listening on {bind_addr}");
    println!("Press Ctrl+C to stop");
    println!();

    // Set up signal handler for graceful shutdown
    let shutdown = tokio::signal::ctrl_c();

    tokio::select! {
        _ = accept_connections(listener, router) => {
            println!("Server stopped accepting connections");
        }
        _ = shutdown => {
            println!();
            println!("Shutting down...");
        }
    }

    println!("Server stopped");
}

async fn accept_connections(listener: tokio::net::TcpListener, router: Arc<Router<u64>>) {
    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                println!("Client connected: {addr}");
                let router = router.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, router).await {
                        eprintln!("Connection error from {addr}: {e}");
                    }
                    println!("Client disconnected: {addr}");
                });
            }
            Err(e) => {
                eprintln!("Failed to accept connection: {e}");
            }
        }
    }
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    router: Arc<Router<u64>>,
) -> Result<(), std::io::Error> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};

    let (read_half, write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let mut writer = BufWriter::new(write_half);

    loop {
        // Read length prefix
        let mut len_buf = [0u8; 4];
        match reader.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                // Client disconnected cleanly
                return Ok(());
            }
            Err(e) => return Err(e),
        }

        let len = u32::from_be_bytes(len_buf) as usize;

        // Sanity check
        if len > 16 * 1024 * 1024 {
            eprintln!("Message too large: {len} bytes");
            return Ok(());
        }

        // Read message
        let mut buf = vec![0u8; len];
        reader.read_exact(&mut buf).await?;

        // Parse and route request
        let response = match links_queue::Request::parse(&buf) {
            Ok(request) => router.route(&request).await,
            Err(e) => links_queue::Response::error(e.message, format!("{}", e.code)),
        };

        // Send response
        let response_bytes = response.to_bytes();
        #[allow(clippy::cast_possible_truncation)]
        let response_len = response_bytes.len() as u32;
        writer.write_all(&response_len.to_be_bytes()).await?;
        writer.write_all(&response_bytes).await?;
        writer.flush().await?;
    }
}
