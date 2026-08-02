package com.example;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitRunnable;
import org.jetbrains.annotations.NotNull;

public class MediumPlugin extends JavaPlugin implements Listener {

    private int greetCount = 0;

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("MediumPlugin enabled!");

        new BukkitRunnable() {
            @Override
            public void run() {
                getLogger().info("Tick: " + greetCount + " greetings served");
            }
        }.runTaskTimer(this, 100L, 6000L);
    }

    @Override
    public void onDisable() {
        getLogger().info("MediumPlugin disabled!");
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        event.getPlayer().sendMessage(ChatColor.GREEN + "Welcome!");
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (command.getName().equalsIgnoreCase("greet")) {
            if (args.length > 0 && args[0].equalsIgnoreCase("all")) {
                if (!sender.hasPermission("mediumplugin.greet.broadcast")) {
                    sender.sendMessage(ChatColor.RED + "No permission");
                    return true;
                }
                for (Player player : Bukkit.getOnlinePlayers()) {
                    player.sendMessage(ChatColor.AQUA + "Hello from MediumPlugin!");
                }
                greetCount++;
                return true;
            }
            sender.sendMessage(ChatColor.AQUA + "Hello, " + sender.getName() + "!");
            greetCount++;
            return true;
        }
        if (command.getName().equalsIgnoreCase("status")) {
            sender.sendMessage(ChatColor.YELLOW + "Greet count: " + greetCount);
            sender.sendMessage(ChatColor.YELLOW + "Online: " + Bukkit.getOnlinePlayers().size());
            return true;
        }
        return false;
    }
}
